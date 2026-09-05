"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Clapperboard,
  FileVideo,
  FileAudio,
  Loader2,
  Download,
  Languages,
  Volume2,
  Captions,
  X,
  RotateCcw,
  Clock,
  FileText,
  ListTree,
  AlertCircle,
  ArrowRight,
  Film,
  Check,
  Cpu,
  Sparkles,
  Tv,
} from "lucide-react";
import { ViewHeader } from "../shared/view-header";
import { LanguageSelect } from "../shared/language-select";
import { UploadDropzone } from "../shared/upload-dropzone";
import { ModelBadge } from "../shared/model-badge";
import { AudioPlayer } from "../shared/audio-player";
import { TranslatedVideoPlayer } from "../shared/translated-video-player";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useAppStore } from "../app-store";
import { formatBytes, getFormatByExt, getCategory } from "@/lib/domain/media-formats";
import { languageLabel, languageNative } from "@/lib/domain/languages";

interface MediaSegment {
  start: number;
  end: number;
  text: string;
}

interface MediaResult {
  transcript: string;
  translatedText: string;
  segments: MediaSegment[];
  sourceSegments?: MediaSegment[];
  outputAudioPath?: string;
  outputSrt?: string;
  outputVtt?: string;
  sourceSrt?: string;
  sourceVtt?: string;
  inputVideoName?: string;
  dubbedVideoName?: string;
  hasVideo?: boolean;
  model: string;
  modelReason: string;
  durationSec?: number;
  jobId: string;
}

const STATUS_MESSAGES = [
  "Extracting audio track from media…",
  "Transcribing spoken speech with Whisper ASR…",
  "Translating sentences with IndicTrans2 300M…",
  "Synthesizing high-fidelity neural voice…",
  "Generating timed SRT & WebVTT subtitles…",
  "Dubbing video container & multiplexing audio…",
  "Finalizing media artifacts…",
];

const getExt = (name: string): string => name.split(".").pop() ?? "";

const formatDuration = (sec?: number): string | null => {
  if (!sec || !isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const formatTimestamp = (sec: number): string => {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const downloadBlob = (content: string, filename: string, mime: string) => {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadUrl = (url: string, filename: string) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const basename = (p: string): string => p.split(/[\\/]/).pop() ?? p;

interface PersistedMediaJob {
  id: string;
  kind: string;
  status: string;
  sourceLang: string;
  targetLang: string;
  inputName: string | null;
  inputMime: string | null;
  inputPath: string | null;
  transcript: string | null;
  outputText: string | null;
  outputAudio: string | null;
  outputSrt: string | null;
  outputVtt: string | null;
  model: string | null;
  modelReason: string | null;
  durationSec: number | null;
  error: string | null;
}

const persistedJobToResult = (job: PersistedMediaJob): MediaResult | null => {
  if (job.kind !== "media") return null;
  const inputName = job.inputPath ? `source_${basename(job.inputPath)}` : undefined;
  const isVideo = Boolean(job.inputMime?.startsWith("video/") || job.inputName?.match(/\.(mp4|mkv|mov|webm|avi)$/i));
  const originalBase = job.inputName ? job.inputName.replace(/\.[^.]+$/, "") : "media";
  const hasDubbedVideo = isVideo && Boolean(job.outputAudio);
  return {
    transcript: job.transcript ?? "",
    translatedText: job.outputText ?? "",
    segments: [],
    sourceSegments: [],
    outputAudioPath: job.outputAudio ?? undefined,
    outputSrt: job.outputSrt ?? undefined,
    outputVtt: job.outputVtt ?? undefined,
    inputVideoName: inputName,
    dubbedVideoName: hasDubbedVideo ? `${originalBase}.${job.targetLang}.dubbed.mp4` : undefined,
    hasVideo: isVideo,
    model: job.model ?? "local",
    modelReason: job.modelReason ?? "Restored from job history",
    durationSec: job.durationSec ?? undefined,
    jobId: job.id,
  };
};

/** Selected file summary card. */
const FileChip = ({ file, onRemove }: { file: File; onRemove: () => void }) => {
  const ext = getExt(file.name);
  const cat = getCategory(ext);
  const Icon = cat === "video" ? FileVideo : FileAudio;
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file.name}</p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatBytes(file.size)}</span>
            <Separator orientation="vertical" className="h-3" />
            <Badge variant="secondary" className="text-[10px] uppercase">
              {cat ?? "file"}
            </Badge>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onRemove} aria-label="Remove file">
          <X className="h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
};

/** Output options card. */
const OptionsCard = ({
  voice, setVoice,
  subtitles, setSubtitles,
  autoModel, setAutoModel,
}: {
  voice: boolean;
  setVoice: (v: boolean) => void;
  subtitles: boolean;
  setSubtitles: (v: boolean) => void;
  autoModel: boolean;
  setAutoModel: (v: boolean) => void;
}) => (
  <Card>
    <CardContent className="space-y-4 p-4">
      <p className="text-sm font-medium">Output options</p>
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-sm">Translated voice (Neural TTS)</Label>
          <p className="text-xs text-muted-foreground">Synthesize spoken audio & dub the video track.</p>
        </div>
        <Switch checked={voice} onCheckedChange={setVoice} aria-label="Generate translated voice" />
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-sm">Subtitles & Captions (SRT + VTT)</Label>
          <p className="text-xs text-muted-foreground">Generate timed interactive subtitle cues.</p>
        </div>
        <Switch checked={subtitles} onCheckedChange={setSubtitles} aria-label="Generate subtitles" />
      </div>
      <Separator />
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label className="text-sm">IndicTrans2 Neural Engine</Label>
          <p className="text-xs text-muted-foreground">AI4Bharat 300M local model with Apple MPS acceleration.</p>
        </div>
        <Switch checked={autoModel} onCheckedChange={setAutoModel} aria-label="Auto select model" />
      </div>
    </CardContent>
  </Card>
);

/** 5-Phase Processing Stepper with real-time status indication */
const PIPELINE_PHASES = [
  {
    step: 1,
    title: "1. Video ➔ Extract Audio",
    desc: "FFmpeg demuxes 16kHz mono audio track from video container",
    icon: Film,
  },
  {
    step: 2,
    title: "2. Audio ➔ Extract Text",
    desc: "Whisper ASR extracts speech segments & precise timestamps",
    icon: Clapperboard,
  },
  {
    step: 3,
    title: "3. Text ➔ Text Conversion",
    desc: "IndicTrans2 translates sentences in context-aware batches",
    icon: Languages,
  },
  {
    step: 4,
    title: "4. Converted Text ➔ Audio",
    desc: "Neural TTS synthesizes target language voice per segment",
    icon: Volume2,
  },
  {
    step: 5,
    title: "5. Audio ➔ Integrate with Video",
    desc: "Matches timestamps, mixes audio track & muxes dubbed video",
    icon: Tv,
  },
];

const ProgressBlock = ({ tick }: { message: string; tick: number }) => {
  const currentStep = Math.min(5, Math.floor(tick / 6) + 1);
  const percent = Math.min(95, Math.round((tick / 30) * 100));

  return (
    <Card className="border-primary/40 shadow-xl bg-card/90 backdrop-blur-md">
      <CardContent className="space-y-5 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <div>
              <p className="text-sm font-semibold">Executing 5-Phase Media Translation Pipeline</p>
              <p className="text-xs text-muted-foreground">
                Phase {currentStep} of 5 active · Running offline local models
              </p>
            </div>
          </div>
          <Badge variant="outline" className="font-mono text-xs px-2.5 py-1">
            {percent}%
          </Badge>
        </div>

        <Progress value={percent} className="h-2" />

        {/* 5-Phase Visual Stepper */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-5 pt-2">
          {PIPELINE_PHASES.map((p) => {
            const isDone = currentStep > p.step;
            const isCurrent = currentStep === p.step;
            const Icon = p.icon;

            return (
              <div
                key={p.step}
                className={`rounded-lg border p-3 transition-all ${
                  isDone
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                    : isCurrent
                    ? "border-primary bg-primary/10 text-primary shadow-sm"
                    : "border-muted bg-muted/20 text-muted-foreground opacity-60"
                }`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  {isDone ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : isCurrent ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  <span className="text-xs font-semibold">{p.title.split(" ➔ ")[0]}</span>
                </div>
                <p className="text-[11px] line-clamp-2 leading-tight">
                  {p.title.split(" ➔ ")[1] || p.title}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};

export function MediaTranslateView() {
  const {
    defaultSourceLang,
    defaultTargetLang,
    setDefaultSourceLang,
    setDefaultTargetLang,
    autoModel,
    setAutoModel,
  } = useAppStore();
  const [source, setSource] = useState(defaultSourceLang && defaultSourceLang !== "auto" ? defaultSourceLang : "mr");
  const [target, setTarget] = useState(defaultTargetLang && defaultTargetLang !== "auto" ? defaultTargetLang : "en");
  const [file, setFile] = useState<File | null>(null);
  const [voice, setVoice] = useState(true);
  const [subtitles, setSubtitles] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MediaResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Rehydrate the latest media job so navigation and browser refresh do not lose the result.
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const restoreLatest = async () => {
      try {
        const response = await fetch("/api/jobs?kind=media&limit=1", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { jobs?: PersistedMediaJob[] };
        const job = data.jobs?.[0];
        if (!active || !job) return;
        if (job.status === "running" || job.status === "queued") {
          setLoading(true);
          setError(null);
        } else if (job.status === "completed") {
          const restored = persistedJobToResult(job);
          if (restored) {
            setResult(restored);
            setLoading(false);
            setError(null);
          }
        } else if (job.status === "failed") {
          setLoading(false);
          setError(job.error ?? "Media translation failed.");
        }
        if (active && (job.status === "running" || job.status === "queued")) {
          timer = setTimeout(restoreLatest, 3000);
        }
      } catch {
        // The in-memory UI remains usable if history is temporarily unavailable.
      }
    };
    void restoreLatest();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  // Progress tick while loading.
  useEffect(() => {
    if (!loading) return;
    const tickTimer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(tickTimer);
  }, [loading]);

  const onFile = useCallback((incoming: File) => {
    const ext = getExt(incoming.name);
    if (!getFormatByExt(ext)) {
      toast.error(`Unsupported file format ".${ext}".`);
      return;
    }
    setResult(null);
    setError(null);
    setFile(incoming);
  }, []);

  const runTranslate = async () => {
    if (!file) {
      toast.error("Please upload a media file first.");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    setTick(0);
    setDefaultSourceLang(source);
    setDefaultTargetLang(target);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("sourceLang", source);
      fd.append("targetLang", target);
      fd.append("voice", String(voice));
      fd.append("subtitles", String(subtitles));
      const res = await fetch("/api/media", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Media translation failed.");
      setResult(data as MediaResult);
      toast.success("5-Phase Video translation complete!");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Media translation failed.");
      toast.error("Translation failed.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setFile(null);
    setResult(null);
    setError(null);
  };

  const isVideoFile = file ? getCategory(getExt(file.name)) === "video" : result?.hasVideo;

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={Clapperboard}
        title="5-Phase Audio & Video Translation"
        nativeTitle="ध्वनी व व्हिडिओ भाषांतर"
        subtitle="End-to-end multi-phase pipeline: Audio Extraction ➔ Whisper ASR ➔ IndicTrans2 NMT ➔ Neural TTS ➔ FFmpeg Dubbed Video Integration."
      />

      {/* Engine Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/60 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1.5 py-1">
            <Cpu className="h-3.5 w-3.5" /> Local Engine Active
          </Badge>
          <span className="text-muted-foreground">
            IndicTrans2 Neural Engine · Whisper ASR (int8) · Edge Neural TTS · FFmpeg Multi-track Muxing
          </span>
        </div>
        <Badge variant="secondary" className="text-[11px] font-mono">
          Device: Apple Silicon (MPS / CPU)
        </Badge>
      </div>

      {/* Language selector row */}
      <Card>
        <CardContent className="flex flex-col items-stretch gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Label className="mb-1.5 block text-xs text-muted-foreground">From (Source Language)</Label>
            <LanguageSelect
              variant="source"
              value={source}
              onChange={setSource}
              className="w-full"
              id="media-source-lang"
            />
          </div>
          <div className="flex items-end justify-center pb-2">
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="flex-1">
            <Label className="mb-1.5 block text-xs text-muted-foreground">To (Target Language)</Label>
            <LanguageSelect
              variant="target"
              value={target}
              onChange={setTarget}
              className="w-full"
              id="media-target-lang"
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Upload + options column */}
        <div className="space-y-4">
          {file ? (
            <FileChip file={file} onRemove={() => setFile(null)} />
          ) : (
            <UploadDropzone onFile={onFile} disabled={loading} />
          )}
          <OptionsCard
            voice={voice}
            setVoice={setVoice}
            subtitles={subtitles}
            setSubtitles={setSubtitles}
            autoModel={autoModel}
            setAutoModel={setAutoModel}
          />
        </div>

        {/* 5-Phase Pipeline Overview Card */}
        <Card>
          <CardContent className="flex h-full flex-col gap-4 p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">5-Phase Pipeline Architecture</p>
              <Badge variant="outline" className="text-[11px]">
                {languageLabel(source)} → {languageLabel(target)}
              </Badge>
            </div>
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <Film className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong>1. Video ➔ Extract Audio:</strong> FFmpeg audio demuxing to 16kHz WAV.
              </p>
              <p className="flex items-center gap-1.5">
                <Clapperboard className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong>2. Audio ➔ Extract Text:</strong> Whisper ASR recognizes speech & timestamps.
              </p>
              <p className="flex items-center gap-1.5">
                <Languages className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong>3. Text ➔ Text Conversion:</strong> IndicTrans2 translates batched cues.
              </p>
              <p className="flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong>4. Converted Text ➔ Audio:</strong> Neural TTS synthesizes target voiceover.
              </p>
              <p className="flex items-center gap-1.5">
                <Tv className="h-3.5 w-3.5 text-primary shrink-0" />
                <strong>5. Audio ➔ Video Integration:</strong> Muxes dubbed track & dual subtitles.
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button onClick={runTranslate} disabled={loading || !file} className="gap-1.5">
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Languages className="h-4 w-4" />
                )}
                Translate media
              </Button>
              {(file || result) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={reset}
                  disabled={loading}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {loading && <ProgressBlock message="Processing 5-Phase Pipeline" tick={tick} />}

      {error && !loading && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Translation failed</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{error}</p>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={runTranslate}>
              <RotateCcw className="h-3.5 w-3.5" /> Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Results Section */}
      {result && !loading && (
        <div className="space-y-6">
          <div className="flex items-center justify-between border-b pb-3">
            <div className="flex items-center gap-2">
              <Tv className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Integrated Video Player & 5-Phase Outputs</h2>
            </div>
            <div className="flex items-center gap-2">
              <ModelBadge modelId={result.model} />
              {result.durationSec && (
                <Badge variant="outline" className="gap-1 text-xs">
                  <Clock className="h-3 w-3" /> {formatDuration(result.durationSec)}
                </Badge>
              )}
            </div>
          </div>

          {/* YouTube-Style Multi-Track Video Player (Stage 5 Integration) */}
          <TranslatedVideoPlayer
            jobId={result.jobId}
            sourceLang={source}
            targetLang={target}
            inputVideoName={result.inputVideoName}
            dubbedVideoName={result.dubbedVideoName}
            audioName={result.outputAudioPath ? basename(result.outputAudioPath) : undefined}
            outputSrt={result.outputSrt}
            outputVtt={result.outputVtt}
            translatedSegments={result.segments || []}
            sourceSegments={result.sourceSegments || []}
            transcriptText={result.transcript}
            translatedText={result.translatedText}
            durationSec={result.durationSec}
          />

          {/* 5-Phase Pipeline Inspector */}
          <Card>
            <CardContent className="p-4 space-y-4">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ListTree className="h-4 w-4 text-primary" /> 5-Phase Pipeline Output Inspection
              </h3>

              <Tabs defaultValue="phase2" className="w-full">
                <TabsList className="grid grid-cols-4 w-full">
                  <TabsTrigger value="phase2" className="text-xs">Phase 2: Source Text</TabsTrigger>
                  <TabsTrigger value="phase3" className="text-xs">Phase 3: Translated Text</TabsTrigger>
                  <TabsTrigger value="phase4" className="text-xs">Phase 4: Target Audio</TabsTrigger>
                  <TabsTrigger value="phase5" className="text-xs">Phase 5: Subtitles & Cues</TabsTrigger>
                </TabsList>

                {/* Phase 2: Source Speech Recognition */}
                <TabsContent value="phase2" className="space-y-3 pt-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Source language: <strong>{languageLabel(source)}</strong></span>
                    <span>{result.sourceSegments?.length || 0} recognized speech segments</span>
                  </div>
                  <ScrollArea className="h-64 rounded-md border p-3 bg-muted/20">
                    <div className="space-y-2">
                      {result.sourceSegments && result.sourceSegments.length > 0 ? (
                        result.sourceSegments.map((s, idx) => (
                          <div key={idx} className="text-xs flex gap-2.5 items-start border-b border-border/40 pb-1.5 last:border-0">
                            <Badge variant="outline" className="font-mono text-[10px] shrink-0">
                              {formatTimestamp(s.start)} - {formatTimestamp(s.end)}
                            </Badge>
                            <span className="leading-relaxed">{s.text}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{result.transcript || "No transcript segments."}</p>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Phase 3: Translated Text */}
                <TabsContent value="phase3" className="space-y-3 pt-3">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Target language: <strong>{languageLabel(target)}</strong></span>
                    <span>{result.segments?.length || 0} translated segments</span>
                  </div>
                  <ScrollArea className="h-64 rounded-md border p-3 bg-muted/20">
                    <div className="space-y-2">
                      {result.segments && result.segments.length > 0 ? (
                        result.segments.map((s, idx) => (
                          <div key={idx} className="text-xs flex gap-2.5 items-start border-b border-border/40 pb-1.5 last:border-0">
                            <Badge variant="outline" className="font-mono text-[10px] shrink-0 text-primary border-primary/30">
                              {formatTimestamp(s.start)} - {formatTimestamp(s.end)}
                            </Badge>
                            <span className="leading-relaxed font-medium">{s.text}</span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted-foreground">{result.translatedText || "No translated segments."}</p>
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                {/* Phase 4: Generated Voice Audio */}
                <TabsContent value="phase4" className="space-y-3 pt-3">
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      Time-aligned synthesized speech track for <strong>{languageLabel(target)}</strong>.
                    </p>
                    {result.outputAudioPath ? (
                      <AudioPlayer src={`/api/download/${result.jobId}/${basename(result.outputAudioPath)}`} />
                    ) : (
                      <p className="text-xs text-muted-foreground">Voice synthesis was disabled or not generated.</p>
                    )}
                  </div>
                </TabsContent>

                {/* Phase 5: Subtitles & Cues */}
                <TabsContent value="phase5" className="space-y-3 pt-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Target Subtitles ({languageLabel(target)})</Label>
                      <div className="flex gap-2">
                        {result.outputSrt && (
                          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => downloadBlob(result.outputSrt!, `subtitles_${target}.srt`, "text/plain")}>
                            <Download className="h-3.5 w-3.5" /> Download .SRT
                          </Button>
                        )}
                        {result.outputVtt && (
                          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => downloadBlob(result.outputVtt!, `subtitles_${target}.vtt`, "text/vtt")}>
                            <Download className="h-3.5 w-3.5" /> Download .VTT
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Source Subtitles ({languageLabel(source)})</Label>
                      <div className="flex gap-2">
                        {result.sourceSrt && (
                          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => downloadBlob(result.sourceSrt!, `subtitles_${source}.srt`, "text/plain")}>
                            <Download className="h-3.5 w-3.5" /> Download .SRT
                          </Button>
                        )}
                        {result.sourceVtt && (
                          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => downloadBlob(result.sourceVtt!, `subtitles_${source}.vtt`, "text/vtt")}>
                            <Download className="h-3.5 w-3.5" /> Download .VTT
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
