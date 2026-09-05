"use client";

import { useState, useRef, useEffect } from "react";
import {
  Languages,
  ArrowLeftRight,
  Copy,
  Check,
  Volume2,
  Loader2,
  Sparkles,
  X,
  Star,
  Mic,
  MicOff,
  ChevronDown,
  Download,
} from "lucide-react";
import { LanguageSelect } from "../shared/language-select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAppStore } from "../app-store";
import { LANGUAGE_LIST, languageLabel } from "@/lib/domain/languages";
import { cn } from "@/lib/utils";

interface TranslateResponse {
  text: string;
  model: string;
  modelReason?: string;
  jobId?: string;
}

const QUICK_LANGS = [
  { code: "mr", label: "Marathi", native: "मराठी" },
  { code: "hi", label: "Hindi", native: "हिन्दी" },
  { code: "en", label: "English", native: "English" },
];

const SAMPLES: Record<string, string> = {
  mr: "महिला शेळी पालन गटांना निविष्ठा खरेदी सुरू झाली आहे. शेळी व्यवस्थापनावर संबंधित प्रशिक्षण आणि आरोग्य व्यवस्थापन तीन ते चार वेगवेगळ्या पद्धतीने केले जाते.",
  hi: "महिला बकरी पालन समूहों के लिए इनपुट खरीद शुरू हो गई है। बकरी प्रबंधन पर संबंधित प्रशिक्षण और स्वास्थ्य प्रबंधन तीन से चार अलग-अलग तरीकों से किया जाता है।",
  en: "Agriculture and livestock management is the backbone of rural livelihoods. Timely veterinary care and proper fodder management ensures healthy cattle and increased milk production.",
};

export function TextTranslateView() {
  const {
    defaultSourceLang,
    defaultTargetLang,
    setDefaultSourceLang,
    setDefaultTargetLang,
  } = useAppStore();

  const [source, setSource] = useState(defaultSourceLang || "mr");
  const [target, setTarget] = useState(defaultTargetLang || "hi");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isStarred, setIsStarred] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Voice recording state
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const translationRequestRef = useRef<AbortController | null>(null);

  // Auto-translate on typing with debounce
  useEffect(() => {
    if (!input.trim()) {
      setResult(null);
      setAudioUrl(null);
      return;
    }

    const timer = setTimeout(() => {
      void runTranslation(input, source, target);
    }, 900);

    return () => {
      clearTimeout(timer);
      translationRequestRef.current?.abort();
    };
  }, [input, source, target]);

  const runTranslation = async (
    textToTranslate: string,
    srcLang: string,
    tgtLang: string,
  ) => {
    if (!textToTranslate.trim()) return;
    translationRequestRef.current?.abort();
    const controller = new AbortController();
    translationRequestRef.current = controller;
    setLoading(true);
    setAudioUrl(null);
    setDefaultSourceLang(srcLang);
    setDefaultTargetLang(tgtLang);

    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: textToTranslate,
          sourceLang: srcLang,
          targetLang: tgtLang,
        }),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Translation failed");
      setResult(data as TranslateResponse);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        toast.error(e instanceof Error ? e.message : "Translation failed");
      }
    } finally {
      if (translationRequestRef.current === controller) {
        translationRequestRef.current = null;
        setLoading(false);
      }
    }
  };

  const swapLanguages = () => {
    const prevSrc = source;
    const prevTgt = target;
    setSource(prevTgt);
    setTarget(prevSrc);
    if (result?.text) {
      setInput(result.text);
      setResult(null);
    }
  };

  const speakText = async (textToSpeak: string, lang: string) => {
    if (!textToSpeak.trim()) return;
    setTtsLoading(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: textToSpeak, language: lang }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "TTS synthesis failed");

      const base = data.path.split("/").pop();
      const jobId = data.path.split("/").slice(-2, -1)[0];
      const url = `/api/download/${jobId}/${base}`;
      setAudioUrl(url);

      // Play audio automatically
      const audio = new Audio(url);
      await audio.play();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Voice synthesis failed");
    } finally {
      setTtsLoading(false);
    }
  };

  const copyResult = async () => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    toast.success("Translation copied to clipboard");
    setTimeout(() => setCopied(false), 1500);
  };

  const toggleStar = () => {
    if (!result?.text) return;
    setIsStarred(!isStarred);
    toast.success(isStarred ? "Removed from saved items" : "Saved to Glossary & Saved Items");
  };

  const downloadResult = () => {
    if (!result?.text) return;
    const blob = new Blob([result.text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `translation_${target}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const loadSample = () => {
    setInput(SAMPLES[source] || SAMPLES.mr);
  };

  const clearInput = () => {
    setInput("");
    setResult(null);
    setAudioUrl(null);
  };

  // Voice recording toggle
  const toggleRecording = async () => {
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      recorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        const formData = new FormData();
        formData.append("file", audioBlob, "voice_input.wav");
        formData.append("language", source);

        toast.info("Transcribing speech with Whisper…");
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });
          const data = await res.json();
          if (data.text) {
            setInput(data.text);
            toast.success("Speech transcribed");
          }
        } catch {
          toast.error("Voice transcription failed");
        }
      };

      mediaRecorder.start();
      setRecording(true);
      toast.info("Listening… speak now");
    } catch {
      toast.error("Microphone access denied");
    }
  };

  return (
    <div className="space-y-4">
      {/* Google Translate Dual-Pane Surface Card */}
      <div className="rounded-2xl border border-border/80 bg-card shadow-lg shadow-black/5 overflow-hidden transition-all duration-300">
        {/* Top Attached Language Quick-Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x border-b bg-muted/20">
          {/* Source Language Bar (Left) */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1 overflow-x-auto scroll-area-thin">
              {QUICK_LANGS.map((l) => (
                <button
                  key={`src-${l.code}`}
                  onClick={() => setSource(l.code)}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-medium transition-all duration-150",
                    source === l.code
                      ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </button>
              ))}

              {/* All Languages Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                  {LANGUAGE_LIST.map((l) => (
                    <DropdownMenuItem
                      key={l.code}
                      onClick={() => setSource(l.code)}
                      className={cn("text-xs font-medium", source === l.code && "bg-accent font-semibold")}
                    >
                      <span>{l.name}</span>
                      <span className="ml-2 text-muted-foreground devanagari">{l.nativeName}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            {/* Language Swap Button */}
            <Button
              variant="ghost"
              size="icon"
              onClick={swapLanguages}
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
              title="Swap languages"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Target Language Bar (Right) */}
          <div className="flex items-center justify-between px-4 py-2.5">
            <div className="flex items-center gap-1 overflow-x-auto scroll-area-thin">
              {QUICK_LANGS.map((l) => (
                <button
                  key={`tgt-${l.code}`}
                  onClick={() => setTarget(l.code)}
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-medium transition-all duration-150",
                    target === l.code
                      ? "bg-primary text-primary-foreground shadow-sm font-semibold"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {l.label}
                </button>
              ))}

              {/* All Languages Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs text-muted-foreground">
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                  {LANGUAGE_LIST.map((l) => (
                    <DropdownMenuItem
                      key={l.code}
                      onClick={() => setTarget(l.code)}
                      className={cn("text-xs font-medium", target === l.code && "bg-accent font-semibold")}
                    >
                      <span>{l.name}</span>
                      <span className="ml-2 text-muted-foreground devanagari">{l.nativeName}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <Badge variant="outline" className="border-primary/30 bg-primary/5 text-[10px] text-primary">
              IndicTrans2 SOTA
            </Badge>
          </div>
        </div>

        {/* Dual Pane Main Area */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border/60 min-h-[300px]">
          {/* Left Pane: Input Box */}
          <div className="flex flex-col justify-between p-5 bg-background">
            <div className="relative flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Enter text to translate…"
                className="w-full h-full min-h-[200px] resize-none border-0 bg-transparent p-0 text-lg leading-relaxed shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/50"
                autoFocus
                spellCheck={false}
              />
            </div>

            {/* Left Bottom Toolbar */}
            <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-3">
              <div className="flex items-center gap-1.5">
                {/* Voice Mic Button */}
                <Button
                  variant={recording ? "destructive" : "ghost"}
                  size="icon"
                  onClick={toggleRecording}
                  className={cn(
                    "h-9 w-9 rounded-full transition-all",
                    recording && "animate-pulse shadow-md",
                  )}
                  title={recording ? "Stop listening" : "Voice input"}
                >
                  {recording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                </Button>

                {/* Sample Text */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={loadSample}
                  className="h-8 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">Sample</span>
                </Button>

                {/* Clear Input */}
                {input && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={clearInput}
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    title="Clear text"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>

              {/* Character Counter */}
              <span className="text-xs text-muted-foreground tabular-nums">
                {input.length} / 5,000
              </span>
            </div>
          </div>

          {/* Right Pane: Translated Output Box */}
          <div className="flex flex-col justify-between p-5 bg-muted/10">
            <div className="relative flex-1">
              {loading ? (
                <div className="space-y-3 py-2">
                  <div className="h-5 w-3/4 rounded-md bg-muted/60 animate-pulse" />
                  <div className="h-5 w-1/2 rounded-md bg-muted/60 animate-pulse" />
                  <div className="h-5 w-5/6 rounded-md bg-muted/60 animate-pulse" />
                </div>
              ) : result ? (
                <p className="text-lg leading-relaxed text-foreground whitespace-pre-wrap select-text font-normal">
                  {result.text}
                </p>
              ) : (
                <p className="text-lg text-muted-foreground/40 font-normal">
                  Translation will appear here…
                </p>
              )}
            </div>

            {/* Right Bottom Toolbar */}
            <div className="flex items-center justify-between pt-4 border-t border-border/40 mt-3">
              <div className="flex items-center gap-1.5">
                {/* TTS Speaker Listen Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => result && speakText(result.text, target)}
                  disabled={!result?.text || ttsLoading}
                  className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                  title="Listen (Edge Neural TTS)"
                >
                  {ttsLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>

                {/* Copy Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={copyResult}
                  disabled={!result?.text}
                  className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                  title="Copy translation"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>

                {/* Star / Save Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleStar}
                  disabled={!result?.text}
                  className={cn(
                    "h-9 w-9 rounded-full text-muted-foreground hover:text-foreground",
                    isStarred && "text-amber-500 hover:text-amber-600",
                  )}
                  title="Save to glossary"
                >
                  <Star className={cn("h-4 w-4", isStarred && "fill-amber-500")} />
                </Button>

                {/* Download Text */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={downloadResult}
                  disabled={!result?.text}
                  className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
                  title="Download translation"
                >
                  <Download className="h-4 w-4" />
                </Button>
              </div>

              {/* Translation Model Tag */}
              {result && (
                <span className="text-[11px] text-muted-foreground/80 font-mono">
                  IndicTrans2 (mps)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
