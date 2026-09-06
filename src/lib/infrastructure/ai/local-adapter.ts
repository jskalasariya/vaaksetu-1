/**
 * Local AI Engine Adapter for VaakSetu.
 *
 * Connects to the local FastAPI microservice (http://127.0.0.1:8000) for:
 *  - IndicTrans2 (200M / 1B) neural translation with context-aware batching
 *  - Whisper Small/Medium ASR (GPU-accelerated when available)
 *  - Piper neural TTS through the local AI service
 *  - Video Dubbing via FFmpeg
 *
 * Cross-platform: works on macOS (MPS/CPU), Windows 11 (CUDA/CPU), Linux (CUDA/CPU).
 */

import type {
  TranslationRequest,
  TranslationResult,
  TranscriptionResult,
  TranscriptionSegment,
  WordTimestamp,
} from "@/lib/domain/types";
import type {
  TranslationEngine,
  TranscriptionEngine,
  TtsEngine,
} from "./engine-contract";

const LOCAL_AI_URL = process.env.LOCAL_AI_URL || "http://127.0.0.1:8000";

const localAiConnectionError = (operation: string, error: unknown): Error => {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Local AI service unavailable during ${operation} at ${LOCAL_AI_URL}. ` +
      `Start scripts/start-local-ai.ps1 and verify /health. (${detail})`,
  );
};

// Cached device description from the last health check
let _cachedDeviceDescription = "Local AI Engine";

export async function isLocalAiAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LOCAL_AI_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    if (res.ok) {
      try {
        const health = await res.json();
        // Cache device info for use in modelReason descriptions
        const device: string = health?.device ?? "cpu";
        const vramGb: number = health?.vram?.total_gb ?? 0;
        const uses1b: boolean = health?.translation?.uses_1b_models ?? false;
        const modelSize = uses1b ? "1B" : "320M";
        _cachedDeviceDescription =
          device === "cuda"
            ? `CUDA GPU (${vramGb.toFixed(1)}GB VRAM) — IndicTrans2 ${modelSize}`
            : device === "mps"
            ? `Apple Silicon MPS (${vramGb.toFixed(1)}GB unified) — IndicTrans2 ${modelSize}`
            : `CPU — IndicTrans2 ${modelSize}`;
      } catch {
        // Health parse failure is non-critical
      }
    }
    return res.ok;
  } catch {
    return false;
  }
}

export const LocalTranslationEngine: TranslationEngine = {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { text, sourceLang, targetLang } = request;

    const res = await fetch(`${LOCAL_AI_URL}/api/translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
        hf_token: process.env.HF_TOKEN || undefined,
      }),
      signal: AbortSignal.timeout(600_000), // 10 min — long documents
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Local translation failed (${res.status}): ${err}`);
    }

    const data = await res.json();
    return {
      text: data.translated_text,
      model: data.model || "indictrans2-local",
      modelReason:
        data.model_detail ||
        `Local IndicTrans2 Neural Engine on ${_cachedDeviceDescription}.`,
      detectedSourceLang:
        sourceLang === "auto" ? data.src_lang ?? sourceLang : sourceLang,
    };
  },
};

/**
 * Translate an array of subtitle/video segments in context-aware batches.
 *
 * This calls the /api/translate-batch endpoint which groups short Whisper segments
 * (2-5 words) into context windows of 10-80 words, preventing the gibberish
 * output that occurs when isolated 3-word fragments are sent individually.
 *
 * Returns segments with translated text and their original timestamps preserved.
 */
export async function translateSegmentsBatched(
  segments: TranscriptionSegment[],
  sourceLang: string,
  targetLang: string,
): Promise<TranscriptionSegment[]> {
  const segData = segments.map((s) => ({
    text: s.text,
    start: s.start,
    end: s.end,
  }));

  const res = await fetch(`${LOCAL_AI_URL}/api/translate-batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      segments: segData,
      source_lang: sourceLang,
      target_lang: targetLang,
      hf_token: process.env.HF_TOKEN || undefined,
    }),
    signal: AbortSignal.timeout(1_200_000), // 20 min — long videos
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local batch translation failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return (data.segments ?? []).map((s: any) => ({
    start: s.start,
    end: s.end,
    text: s.text,
  }));
}

export const LocalTranscriptionEngine: TranscriptionEngine = {
  async transcribe(
    audioPath: string,
    language?: string,
    modelId?: string,
  ): Promise<TranscriptionResult> {
    let modelSize = "turbo";
    if (modelId?.includes("small")) modelSize = "small";
    else if (modelId?.includes("medium")) modelSize = "medium";
    else if (modelId?.includes("turbo") || modelId?.includes("large")) modelSize = "turbo";

    // Use the YouTube-grade endpoint that returns word-level timestamps
    // and fine-grained sentence segments instead of coarse VAD chunks
    let res: Response;
    try {
      res = await fetch(`${LOCAL_AI_URL}/api/transcribe-sentences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audio_path: audioPath,
          language: language && language !== "auto" ? language : undefined,
          model_size: modelSize,
        }),
        signal: AbortSignal.timeout(1_200_000), // 20 min — up to 30 min videos
      });
    } catch (error) {
      throw localAiConnectionError("transcription", error);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Local transcription failed (${res.status}): ${err}`);
    }

    const data = await res.json();

    // Fine-grained sentence segments (YouTube-grade, from reconstruct_sentences)
    const segments: TranscriptionSegment[] = (data.segments || []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));

    // Coarse VAD segments (for debugging / fallback)
    const coarseSegments: TranscriptionSegment[] = (data.coarse_segments || []).map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text,
    }));

    // Word-level timestamps for karaoke-style UI highlighting
    const words: WordTimestamp[] = (data.words || []).map((w: any) => ({
      word: w.word,
      start: w.start,
      end: w.end,
      probability: w.probability ?? 1.0,
    }));

    return {
      text: data.text,
      segments,
      coarseSegments: coarseSegments.length > 0 ? coarseSegments : undefined,
      words: words.length > 0 ? words : undefined,
      detectedLanguage: data.detected_language || language || "hi",
      model: data.model || "whisper-local",
    };
  },
};

/**
 * Dedicated YouTube-grade transcription function.
 * Identical to LocalTranscriptionEngine.transcribe() but explicit for clarity
 * when calling from MediaTranslator.ts.
 */
export async function transcribeSentences(
  audioPath: string,
  language?: string,
  modelId?: string,
): Promise<TranscriptionResult> {
  return LocalTranscriptionEngine.transcribe(audioPath, language, modelId);
}

export const LocalTtsEngine: TtsEngine = {
  async synthesize(text: string, language: string): Promise<Buffer> {
    const res = await fetch(`${LOCAL_AI_URL}/api/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, language }),
      signal: AbortSignal.timeout(600_000),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Local TTS failed (${res.status}): ${err}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  },
};

export async function requestLocalDub(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  duckOriginal = false,
): Promise<string> {
  const res = await fetch(`${LOCAL_AI_URL}/api/dub`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      video_path: videoPath,
      audio_path: audioPath,
      output_path: outputPath,
      duck_original: duckOriginal,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Local dubbing failed (${res.status}): ${err}`);
  }

  const data = await res.json();
  return data.output_path;
}

/** Request model offload to free VRAM before switching modules. */
export async function requestModelOffload(): Promise<void> {
  try {
    await fetch(`${LOCAL_AI_URL}/api/system/offload`, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // Non-critical — offload is best-effort
  }
}
