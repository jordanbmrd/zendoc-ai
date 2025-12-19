import os
import base64
import json
import io
from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mistralai import Mistral
from pydantic import BaseModel
import fitz  # PyMuPDF
from typing import List, Dict, Any, Optional

# Load env vars
from dotenv import load_dotenv
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

api_key = os.environ.get("MISTRAL_API_KEY")
client = Mistral(api_key=api_key)

# --- SHARED LOGIC ---

async def process_pdf_bytes(file_content: bytes):
    """
    Core logic to analyze PDF, tag fields, and ask Pixtral for mapping.
    """
    doc = fitz.open(stream=file_content, filetype="pdf")
    doc_tagged = fitz.open(stream=file_content, filetype="pdf")
    
    if doc.page_count == 0:
        raise ValueError("Invalid PDF")

    page = doc[0]
    page_tagged = doc_tagged[0]
    
    # 1. Generate CLEAN image for User
    pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
    img_user_data = pix.tobytes("jpeg")
    base64_user_image = base64.b64encode(img_user_data).decode('utf-8')

    fields = []
    fields_for_ai = []
    
    page_w = page.rect.width
    page_h = page.rect.height

    # 2. Draw on PDF
    for index, widget in enumerate(page_tagged.widgets()):
        rect = widget.rect
        simple_id = index + 1
        
        # Draw red box
        shape = page_tagged.new_shape()
        shape.draw_rect(rect)
        shape.finish(color=(1, 0, 0), width=1.5)
        shape.commit()
        
        # Insert ID text
        insert_point = fitz.Point(max(0, rect.x0), max(10, rect.y0))
        page_tagged.insert_text(
            insert_point, 
            f"#{simple_id}", 
            fontsize=12, 
            color=(1, 0, 0),
            render_mode=0
        )

        # Frontend Data
        fields.append({
            "id": str(widget.xref),
            "simple_id": simple_id,
            "label": f"Field {simple_id}", 
            "explanation": "Analyzing...",
            "top": (rect.y0 / page_h) * 100,
            "left": (rect.x0 / page_w) * 100,
            "width": ((rect.x1 - rect.x0) / page_w) * 100,
            "height": ((rect.y1 - rect.y0) / page_h) * 100,
            "value": widget.field_value,
            "isAutoFilled": False
        })
        fields_for_ai.append(simple_id)

    # 3. Generate DIRTY image for AI
    pix_ai = page_tagged.get_pixmap(matrix=fitz.Matrix(2, 2))
    img_tagged_data = pix_ai.tobytes("jpeg")
    base64_tagged_image = base64.b64encode(img_tagged_data).decode('utf-8')

    doc.close()
    doc_tagged.close()

    # 4. Mistral Vision Call
    if fields:
        # English Prompt
        prompt = f"""
        Analyze this administrative form. You see red numbers (e.g., #1, #2...) on the input fields.
        For each number, find the FULL NAME/LABEL of the field.
        
        NAMING RULES:
        1. CONTEXT IS KING: If the immediate text is generic (e.g., "YES", "NO", "Other", "Checkbox"), you MUST look visually higher or to the left to find the QUESTION or SECTION TITLE.
           - BAD: "Checkbox YES"
           - GOOD: "Business Registration - YES"
        
        2. For checkboxes: Concatenate the row title with the chosen option.
        
        List of IDs to identify: {json.dumps(fields_for_ai)}
        
        Return ONLY a JSON in this format:
        {{
            "ID": "Section Title - Option / Field Name"
        }}
        """

        try:
            ai_response = client.chat.complete(
                model="pixtral-12b-2409",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": f"data:image/jpeg;base64,{base64_tagged_image}"}
                        ]
                    }
                ],
                response_format={"type": "json_object"}
            )
            
            content = ai_response.choices[0].message.content
            print("AI Mapping Response:", content)
            mapping = json.loads(content)
            
            for field in fields:
                s_id = str(field["simple_id"])
                if s_id in mapping:
                    field["label"] = mapping[s_id]
                    field["explanation"] = mapping[s_id]

        except Exception as e:
            print(f"AI Mapping Error: {e}")

    return {
        "image_data": f"data:image/jpeg;base64,{base64_user_image}",
        "analysis": {
            "fields": fields
        }
    }

# --- ROUTES ---

class ChatRequest(BaseModel):
    user_query: str
    current_field_label: str
    current_field_explanation: str

@app.post("/analyze-doc")
async def analyze_document(file: UploadFile):
    try:
        content = await file.read()
        return await process_pdf_bytes(content)
    except Exception as e:
        print(f"Critical Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/load-example")
async def load_example():
    """
    Loads 'cerfa_11768.pdf' from the local server directory.
    """
    file_name = "./cerfa-11768.pdf"
    
    if not os.path.exists(file_name):
        raise HTTPException(status_code=404, detail=f"Example file '{file_name}' not found on server.")
    
    try:
        with open(file_name, "rb") as f:
            content = f.read()
        return await process_pdf_bytes(content)
    except Exception as e:
        print(f"Error loading example: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/ask-assistant")
async def ask_assistant(request: ChatRequest):
    # English System Prompt
    system_prompt = f"""
    You are an expert in business formalities and administrative forms.
    The user is trying to fill out: "{request.current_field_label}".
    Instruction: Give a short, direct, and professional answer to help them fill this specific field.
    """
    
    chat_response = client.chat.complete(
        model="mistral-small-2506",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": request.user_query}
        ]
    )
    return {"reply": chat_response.choices[0].message.content}

class InterviewStartRequest(BaseModel):
    fields: List[Dict[str, Any]]

class InterviewAnswerRequest(BaseModel):
    user_response: str
    fields: List[Dict[str, Any]]
    previous_context: str = ""

@app.post("/start-interview")
async def start_interview(req: InterviewStartRequest):
    empty_fields_labels = [f['label'] for f in req.fields if not f.get('value')]
    
    # English Prompt
    prompt = f"""
    You are an intelligent administrative assistant. Here is a list of fields to fill in a form:
    {empty_fields_labels}

    Goal: Fill this document by asking 3 or 4 open-ended questions to the user instead of asking field by field.
    
    TASK: Generate ONLY the FIRST open-ended question (broadest possible) to start filling these fields.
    Example: "Tell me about your project and your personal details."
    
    Do not say hello, just ask the question.
    """

    chat_response = client.chat.complete(
        model="mistral-large-latest",
        messages=[{"role": "user", "content": prompt}]
    )
    
    return {"question": chat_response.choices[0].message.content}

@app.post("/process-interview-answer")
async def process_interview_answer(req: InterviewAnswerRequest):
    fields_schema = [{"id": f["simple_id"], "label": f["label"]} for f in req.fields]
    
    # English Prompt
    prompt = f"""
    CONTEXT: The user is answering a question to fill out a form.
    LIST OF FIELDS TO FILL (ID: Label):
    {json.dumps(fields_schema)}

    USER RESPONSE:
    "{req.user_response}"

    TASK 1: Extraction
    Identify information in the response that matches the fields.
    If the user says "My name is Thomas", and there is a "First Name" field, associate them.
    
    TASK 2: Next Question
    If important fields remain empty, formulate a short next question.
    If everything seems covered by the current response or we have made good progress, return null for the question.

    EXPECTED OUTPUT FORMAT (JSON):
    {{
        "extracted_data": {{ "FIELD_ID": "EXTRACTED_VALUE", "FIELD_ID_2": "VALUE" }},
        "next_question": "The next question or null"
    }}
    """

    try:
        response = client.chat.complete(
            model="mistral-large-latest",
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"}
        )
        
        content = json.loads(response.choices[0].message.content)
        return content

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Extraction error: {str(e)}")