import React, { useState, useRef, useEffect } from 'react';
import { Send, Upload, FileText, Bot, Sparkles, CornerDownLeft, X, AlertCircle, Loader2, Wand2, CheckCircle2, FileInput } from 'lucide-react';

// Ensure these imports match your UI component structure
import { Button } from "./components/ui/button";
import { Input } from "./components/ui/input";
import { ScrollArea } from "./components/ui/scroll-area";
import { Badge } from "./components/ui/badge";

const DocumentEditor = () => {
    // --- STATES ---
    const [docImage, setDocImage] = useState(null);
    const [fields, setFields] = useState([]);
    const [activeField, setActiveField] = useState(null);
    const [mode, setMode] = useState('manual'); // 'manual' or 'interview'

    const [isLoading, setIsLoading] = useState(false);
    const [isSending, setIsSending] = useState(false);
    const [error, setError] = useState(null);

    const [messages, setMessages] = useState([
        { role: 'ai', text: "Hello. Import a document so I can analyze it with Pixtral." }
    ]);
    const [inputValue, setInputValue] = useState("");
    const chatEndRef = useRef(null);

    useEffect(() => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    // --- LOGIC ---

    const handleDataResponse = (data) => {
        setDocImage(data.image_data);
        setFields(data.analysis.fields || []);
        setMessages(prev => [...prev, {
            role: 'ai',
            text: `Analysis complete. I detected ${data.analysis.fields?.length || 0} input fields.`
        }]);
    }

    const handleFileUpload = async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        resetState();
        setIsLoading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('http://127.0.0.1:8000/analyze-doc', {
                method: 'POST',
                body: formData,
            });
            if (!response.ok) throw new Error("Analysis failed");
            const data = await response.json();
            handleDataResponse(data);
        } catch (err) {
            handleError(err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleLoadExample = async () => {
        resetState();
        setIsLoading(true);

        try {
            const response = await fetch('http://127.0.0.1:8000/load-example', {
                method: 'POST',
            });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || "Could not load example");
            }
            const data = await response.json();
            handleDataResponse(data);
        } catch (err) {
            handleError(err);
        } finally {
            setIsLoading(false);
        }
    };

    const resetState = () => {
        setError(null);
        setDocImage(null);
        setFields([]);
        setActiveField(null);
        setMode('manual');
        setMessages([{ role: 'ai', text: "Visual and structural analysis in progress..." }]);
    };

    const handleError = (err) => {
        console.error(err);
        setError(err.message || "Impossible to analyze. Check backend.");
        setMessages(prev => [...prev, { role: 'ai', text: "Critical error connecting to server." }]);
    };

    const startAutoFill = async () => {
        if (fields.length === 0) return;
        setMode('interview');
        setIsSending(true);

        try {
            const response = await fetch('http://127.0.0.1:8000/start-interview', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fields: fields })
            });
            const data = await response.json();
            setMessages(prev => [...prev, { role: 'ai', text: data.question, isInterview: true }]);
        } catch (err) {
            console.error(err);
            setMessages(prev => [...prev, { role: 'ai', text: "Error starting interview." }]);
            setMode('manual');
        } finally {
            setIsSending(false);
        }
    };

    const handleInterviewAnswer = async (userText) => {
        const response = await fetch('http://127.0.0.1:8000/process-interview-answer', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_response: userText,
                fields: fields
            })
        });
        const data = await response.json();

        if (data.extracted_data) {
            let filledCount = 0;
            const newFields = fields.map(field => {
                const key = String(field.simple_id);
                if (data.extracted_data[key]) {
                    filledCount++;
                    return { ...field, value: data.extracted_data[key], isAutoFilled: true };
                }
                return field;
            });
            setFields(newFields);

            if (filledCount > 0) {
                setMessages(prev => [...prev, {
                    role: 'system',
                    text: `✅ ${filledCount} field(s) automatically filled.`
                }]);
            }
        }

        if (data.next_question) {
            setMessages(prev => [...prev, { role: 'ai', text: data.next_question, isInterview: true }]);
        } else {
            setMessages(prev => [...prev, { role: 'ai', text: "Interview finished. I've filled what I could!" }]);
            setMode('manual');
        }
    };

    const handleSendMessage = async () => {
        if (!inputValue.trim()) return;

        const userMsg = inputValue;
        setInputValue("");
        setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
        setIsSending(true);

        try {
            if (mode === 'interview') {
                await handleInterviewAnswer(userMsg);
            } else {
                const contextPayload = {
                    user_query: userMsg,
                    current_field_label: activeField ? activeField.label : "No field selected",
                    current_field_explanation: activeField ? activeField.explanation : "General context"
                };

                const response = await fetch('http://127.0.0.1:8000/ask-assistant', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(contextPayload)
                });
                const data = await response.json();
                setMessages(prev => [...prev, { role: 'ai', text: data.reply }]);
            }

        } catch (err) {
            setMessages(prev => [...prev, { role: 'ai', text: "Error communicating with AI." }]);
        } finally {
            setIsSending(false);
        }
    };

    // --- RENDER ---

    return (
        <div className="flex h-screen w-full bg-[#09090b] text-zinc-100 font-sans selection:bg-zinc-800 overflow-hidden">

            {/* LEFT: DOCUMENT VIEWER */}
            <div className="flex-1 flex flex-col relative border-r border-zinc-800/60 bg-zinc-950/50">

                {/* Navbar */}
                <div className="h-16 border-b border-zinc-800/60 flex items-center justify-between px-8 bg-[#09090b]/80 backdrop-blur-md z-20">
                    <div className="flex items-center gap-3">
                        <div className="bg-zinc-900 p-2 rounded-lg border border-zinc-800">
                            <FileText className="w-4 h-4 text-zinc-400" />
                        </div>
                        <span className="text-sm font-medium tracking-tight text-zinc-200">
                            {docImage ? "Document_Analysis.jpg" : "Viewer"}
                        </span>
                    </div>

                    <div className="flex items-center gap-4">
                        {fields.length > 0 && (
                            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800">
                                <span className={`relative flex h-2 w-2`}>
                                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${mode === 'interview' ? 'bg-indigo-400' : 'bg-emerald-400'}`}></span>
                                    <span className={`relative inline-flex rounded-full h-2 w-2 ${mode === 'interview' ? 'bg-indigo-500' : 'bg-emerald-500'}`}></span>
                                </span>
                                <span className="text-xs text-zinc-400 font-medium">
                                    {mode === 'interview' ? 'Interview Active' : `${fields.length} active fields`}
                                </span>
                            </div>
                        )}
                        {docImage && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => { setDocImage(null); setFields([]); setMode('manual'); }}
                                className="text-zinc-500 hover:text-red-400 hover:bg-red-950/10"
                            >
                                <X className="w-4 h-4" />
                            </Button>
                        )}
                    </div>
                </div>

                {/* Main Area */}
                <div className="flex-1 overflow-hidden relative flex items-center justify-center bg-[radial-gradient(#18181b_1px,transparent_1px)] [background-size:16px_16px]">

                    {!docImage ? (
                        /* Upload Zone */
                        <div className="flex flex-col items-center gap-6 w-full max-w-lg">
                            {/* Main Upload Box */}
                            <div className="flex flex-col items-center justify-center w-full p-12 border border-dashed border-zinc-800 rounded-2xl bg-zinc-900/20 hover:bg-zinc-900/40 transition-all duration-300 group cursor-pointer relative">
                                <div className="p-5 rounded-full bg-zinc-900 shadow-xl shadow-black/20 group-hover:scale-110 transition-transform duration-300 border border-zinc-800">
                                    <Upload className="w-6 h-6 text-zinc-400 group-hover:text-white transition-colors" />
                                </div>
                                <h3 className="mt-8 text-lg font-medium text-zinc-200">Import Form</h3>
                                <p className="mt-2 text-sm text-zinc-500 text-center max-w-xs">
                                    PDF or Image. Pixtral AI will detect the structure automatically.
                                </p>
                                <input type="file" onChange={handleFileUpload} className="absolute inset-0 opacity-0 cursor-pointer" accept=".pdf,image/*" />
                            </div>

                            <div className="flex items-center gap-4 w-full">
                                <div className="h-px bg-zinc-800 flex-1"></div>
                                <span className="text-xs text-zinc-600 uppercase font-medium">Or</span>
                                <div className="h-px bg-zinc-800 flex-1"></div>
                            </div>

                            {/* Load Example Button */}
                            <Button
                                variant="outline"
                                className="w-full h-12 border-zinc-700 bg-zinc-900 text-zinc-300 hover:text-white hover:bg-zinc-800 hover:border-zinc-600 transition-all"
                                onClick={handleLoadExample}
                            >
                                <FileText className="w-4 h-4 mr-2" />
                                Load Example File (Cerfa 11768*08)
                            </Button>

                            {error && (
                                <div className="flex items-center gap-2 text-red-400 text-sm bg-red-950/20 px-4 py-2 rounded-lg border border-red-900/50">
                                    <AlertCircle className="w-4 h-4" />
                                    {error}
                                </div>
                            )}
                        </div>
                    ) : (
                        /* Document View */
                        <ScrollArea className="h-full w-full p-8">
                            <div className="relative w-full max-w-3xl mx-auto shadow-2xl shadow-black border border-zinc-800 rounded-md overflow-hidden bg-white animate-in zoom-in-95 duration-500">
                                <img src={docImage} alt="Analyzed Document" className="w-full h-auto block opacity-95" />

                                {fields.map((field, idx) => {
                                    const isActive = activeField?.id === field.id;
                                    const isFilled = field.value && field.value.length > 0;

                                    return (
                                        <div
                                            key={field.id || idx}
                                            onClick={() => setActiveField(field)}
                                            className={`absolute cursor-pointer transition-all duration-300 rounded-[2px] border
                                                ${isActive
                                                    ? 'ring-2 ring-indigo-500 z-30'
                                                    : 'z-10'
                                                }
                                                ${isFilled
                                                    ? 'bg-emerald-500/30 border-emerald-600'
                                                    : 'bg-black/5 hover:bg-indigo-500/10 border-transparent'
                                                }
                                            `}
                                            style={{
                                                top: `${field.top}%`,
                                                left: `${field.left}%`,
                                                width: `${field.width}%`,
                                                height: `${field.height}%`,
                                            }}
                                        >
                                            {/* Tooltip Label */}
                                            {isActive && !isFilled && (
                                                <div className="absolute -top-8 left-0 bg-zinc-950 text-white text-[10px] px-2 py-1 rounded border border-zinc-800 shadow-xl whitespace-nowrap z-50">
                                                    {field.label}
                                                </div>
                                            )}

                                            {/* Filled Value */}
                                            {isFilled && (
                                                <div className="absolute inset-0 flex items-center justify-center p-1 overflow-hidden">
                                                    <span className="text-[8px] md:text-[10px] font-bold text-emerald-900 bg-emerald-100/80 px-1 rounded truncate w-full text-center">
                                                        {field.value}
                                                    </span>
                                                </div>
                                            )}

                                            {/* New/AutoFilled Indicator */}
                                            {field.isAutoFilled && (
                                                <span className="absolute -top-2 -right-2 h-4 w-4 bg-indigo-500 rounded-full flex items-center justify-center animate-bounce z-40 border border-white">
                                                    <CheckCircle2 className="w-3 h-3 text-white" />
                                                </span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </ScrollArea>
                    )}

                    {isLoading && (
                        <div className="absolute inset-0 bg-[#09090b]/80 backdrop-blur-sm flex flex-col items-center justify-center z-50 animate-in fade-in duration-300">
                            <Loader2 className="w-8 h-8 text-indigo-500 animate-spin mb-4" />
                            <p className="text-sm text-zinc-400 animate-pulse font-medium">Pixtral is analyzing the document...</p>
                        </div>
                    )}
                </div>
            </div>

            {/* RIGHT: AI ASSISTANT */}
            <div className="w-[400px] flex flex-col bg-[#09090b] border-l border-zinc-800/60 shadow-2xl z-30">

                {/* Header */}
                <div className="h-16 flex items-center justify-between px-6 border-b border-zinc-800/60 bg-[#09090b]">
                    <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-indigo-500/10 flex items-center justify-center border border-indigo-500/20">
                            <Sparkles className="w-4 h-4 text-indigo-400" />
                        </div>
                        <div>
                            <h2 className="text-sm font-semibold text-zinc-100">Synapse AI</h2>
                            <div className="flex items-center gap-1.5">
                                <span className={`w-1.5 h-1.5 rounded-full ${isLoading || isSending ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`}></span>
                                <p className="text-[11px] text-zinc-500 font-medium">Online</p>
                            </div>
                        </div>
                    </div>

                    {fields.length > 0 && mode === 'manual' && (
                        <Button
                            onClick={startAutoFill}
                            size="sm"
                            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 h-8 text-xs gap-2 transition-all"
                        >
                            <Wand2 className="w-3 h-3 text-indigo-400" />
                            Auto-Fill
                        </Button>
                    )}
                    {mode === 'interview' && (
                        <Badge variant="outline" className="border-indigo-500/50 text-indigo-400 bg-indigo-950/20 animate-pulse">
                            Interview Mode
                        </Badge>
                    )}
                </div>

                {/* Context Card */}
                <div className={`transition-all duration-500 ease-in-out border-b border-zinc-800/60 bg-zinc-900/30 overflow-hidden
                    ${activeField ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
                    {activeField && (
                        <div className="p-5">
                            <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">
                                    Active Field
                                </Badge>
                                {activeField.value && (
                                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm">
                                        Filled
                                    </Badge>
                                )}
                            </div>
                            <p className="text-sm font-medium text-zinc-200 mb-1">{activeField.label}</p>
                            <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{activeField.explanation}</p>
                            {activeField.value && (
                                <div className="mt-2 bg-zinc-950 p-2 rounded border border-zinc-800 text-xs text-zinc-300 font-mono">
                                    Val: {activeField.value}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Chat Area */}
                <ScrollArea className="flex-1 p-6">
                    <div className="space-y-6">
                        {messages.map((msg, index) => (
                            <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`flex flex-col max-w-[85%] gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                    <div className={`px-4 py-3 text-sm leading-relaxed shadow-sm
                                        ${msg.role === 'user'
                                            ? 'bg-zinc-100 text-zinc-900 rounded-2xl rounded-tr-sm'
                                            : msg.role === 'system'
                                                ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-800/30 rounded-xl w-full text-center text-xs'
                                                : msg.isInterview
                                                    ? 'bg-indigo-950/40 text-indigo-100 border border-indigo-800/40 rounded-2xl rounded-tl-sm'
                                                    : 'bg-zinc-800/50 text-zinc-300 border border-zinc-800 rounded-2xl rounded-tl-sm'
                                        }`}>
                                        {msg.text}
                                    </div>
                                    {msg.role !== 'system' && (
                                        <span className="text-[10px] text-zinc-600 px-1 opacity-60">
                                            {msg.role === 'user' ? 'You' : 'Synapse AI'}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}

                        {isSending && (
                            <div className="flex justify-start">
                                <div className="bg-zinc-800/30 px-4 py-3 rounded-2xl rounded-tl-sm flex items-center gap-1.5">
                                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                                    <span className="w-1 h-1 bg-zinc-500 rounded-full animate-bounce"></span>
                                </div>
                            </div>
                        )}
                        <div ref={chatEndRef} />
                    </div>
                </ScrollArea>

                {/* Input Area */}
                <div className="p-5 bg-[#09090b] border-t border-zinc-800/60">
                    <form
                        onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                        className="relative group"
                    >
                        <Input
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            placeholder={mode === 'interview'
                                ? "Answer the question to fill..."
                                : (activeField ? `Question about "${activeField.label}"...` : "Ask a question...")
                            }
                            className={`bg-zinc-900/50 border-zinc-800 focus-visible:ring-1 text-zinc-100 pr-12 h-12 rounded-xl transition-all placeholder:text-zinc-600 shadow-inner
                                ${mode === 'interview' ? 'focus-visible:ring-indigo-500 border-indigo-900/30' : 'focus-visible:ring-indigo-500'}
                            `}
                            disabled={isLoading || isSending}
                        />
                        <Button
                            type="submit"
                            size="icon"
                            disabled={!inputValue.trim() || isLoading || isSending}
                            className={`absolute right-1.5 top-1.5 w-9 h-9 rounded-lg transition-all duration-200
                                ${inputValue.trim()
                                    ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'
                                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'}`}
                        >
                            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CornerDownLeft className="w-4 h-4" />}
                        </Button>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default DocumentEditor;