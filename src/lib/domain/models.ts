/**
 * Model registry + selection metadata for VaakSetu.
 *
 * Production uses open-source models only (no licensing/usage cost), running on-prem:
 *  - Translation: IndicTrans2 (AI4Bharat)
 *  - Transcription (ASR): Whisper
 *  - Text-to-speech: AI4Bharat TTS / IndicTTS
 *  - Summarization / chat / document QA: an open-source LLM (e.g. IndicLLM / Qwen)
 *
 * In this sandbox demo, the same engine interfaces are backed by z-ai-web-dev-sdk so the
 * full product is functional end-to-end. Swapping to the on-prem models only requires
 * replacing the adapter implementations (see src/lib/infrastructure/ai).
 */

export type EngineRole = "translation" | "transcription" | "tts" | "llm";

export interface ModelDescriptor {
  id: string;
  role: EngineRole;
  name: string;
  /** Open-source license / origin */
  provider: string;
  license: string;
  /** Whether this engine is currently available in the running deployment */
  available: boolean;
  /** Relative quality (0-1) used by the auto-selector */
  quality: number;
  /** Relative speed (0-1) used by the auto-selector */
  speed: number;
  /** Approximate VRAM/RAM footprint in GB */
  footprintGb: number;
  /** Languages this model supports ("*" = all) */
  languages: string[];
  /** Short human-readable note */
  note: string;
}

/**
 * All 22+ IndicTrans2-supported language codes.
 * Used to correctly scope model language support in the registry.
 */
const ALL_INDIC_LANGS = [
  "mr", "hi", "en", "bn", "gu", "ta", "te", "kn", "ml",
  "pa", "or", "ur", "as", "sa", "sd", "ne", "bho", "mai",
  "dgo", "kok", "kas", "mni", "sat",
];

export const MODEL_REGISTRY: ModelDescriptor[] = [
  // ── Translation ─────────────────────────────────────────────────────────
  {
    id: "indictrans2",
    role: "translation",
    name: "IndicTrans2 (Distilled)",
    provider: "AI4Bharat",
    license: "MIT",
    available: true,
    quality: 0.90,
    speed: 0.82,
    footprintGb: 2.4,
    languages: ALL_INDIC_LANGS,
    note: "200M–320M distilled models for devices with <6GB VRAM. Fast, offline.",
  },
  {
    id: "indictrans2-1b",
    role: "translation",
    name: "IndicTrans2 (1B Full)",
    provider: "AI4Bharat",
    license: "MIT",
    available: true,
    quality: 0.97,
    speed: 0.62,
    footprintGb: 5.5,
    languages: ALL_INDIC_LANGS,
    note: "1B parameter models auto-selected when ≥6GB VRAM available. Best Indic quality.",
  },
  // ── Transcription (ASR) ─────────────────────────────────────────────────
  {
    id: "whisper-large-v3-turbo",
    role: "transcription",
    name: "Whisper Large v3 Turbo",
    provider: "OpenAI (open-source)",
    license: "MIT",
    available: true,
    quality: 0.96,
    speed: 0.88,
    footprintGb: 1.6,
    languages: ALL_INDIC_LANGS,
    note: "SOTA ASR model optimized for Indian regional dialects, noisy audio & accents.",
  },
  {
    id: "whisper-medium",
    role: "transcription",
    name: "Whisper Medium",
    provider: "OpenAI (open-source)",
    license: "MIT",
    available: true,
    quality: 0.91,
    speed: 0.62,
    footprintGb: 3.2,
    languages: ALL_INDIC_LANGS,
    note: "Higher-accuracy ASR for noisy or long recordings. GPU-accelerated on CUDA.",
  },
  {
    id: "whisper-small",
    role: "transcription",
    name: "Whisper Small",
    provider: "OpenAI (open-source)",
    license: "MIT",
    available: true,
    quality: 0.82,
    speed: 0.90,
    footprintGb: 1.0,
    languages: ALL_INDIC_LANGS,
    note: "Fast on-device ASR; GPU-accelerated on CUDA. Good for short clips.",
  },
  // ── TTS ─────────────────────────────────────────────────────────────────
  {
    id: "ai4bharat-tts",
    role: "tts",
    name: "Piper Neural TTS",
    provider: "Piper local voice models",
    license: "Open voice model license",
    available: true,
    quality: 0.90,
    speed: 0.80,
    footprintGb: 0.1, // Voice model is stored locally
    languages: ["mr", "hi", "en", "bn", "gu", "ta", "te", "kn", "ml", "ur"],
    note: "Natural offline neural speech from a locally staged Piper voice model.",
  },
  // ── LLM ─────────────────────────────────────────────────────────────────
  {
    id: "indic-llm",
    role: "llm",
    name: "IndicLLM",
    provider: "AI4Bharat (open-source)",
    license: "MIT",
    available: true,
    quality: 0.88,
    speed: 0.70,
    footprintGb: 4.5,
    languages: ["mr", "hi", "en"],
    note: "Open-source LLM for summarization, chat, and document QA.",
  },
];

export const modelsByRole = (role: EngineRole): ModelDescriptor[] =>
  MODEL_REGISTRY.filter((m) => m.role === role);

export const getModel = (id: string): ModelDescriptor | undefined =>
  MODEL_REGISTRY.find((m) => m.id === id);

/** Default per-role model (highest quality among available). */
export const defaultModelForRole = (role: EngineRole): ModelDescriptor =>
  modelsByRole(role)
    .filter((m) => m.available)
    .sort((a, b) => b.quality - a.quality)[0];
