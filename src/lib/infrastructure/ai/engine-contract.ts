/**
 * Engine contracts (ports) for VaakSetu.
 *
 * The application layer depends only on these interfaces. The concrete implementation in
 * `zai-adapter.ts` backs the demo with z-ai-web-dev-sdk. A production deployment ships an
 * `onprem-adapter.ts` that calls IndicTrans2 / Whisper / AI4Bharat TTS / an open-source LLM
 * running locally — with zero changes above this layer (Clean Architecture).
 */

import type { TranslationRequest, TranslationResult } from "@/lib/domain/types";
import type { TranscriptionResult } from "@/lib/domain/types";

export interface TranslationEngine {
  translate(request: TranslationRequest): Promise<TranslationResult>;
}

export interface TranscriptionEngine {
  transcribe(
    audioPath: string,
    language?: string,
    modelId?: string,
  ): Promise<TranscriptionResult>;
}

export interface TtsEngine {
  synthesize(text: string, language: string, opts?: { speed?: number }): Promise<Buffer>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmEngine {
  /** Single-turn completion. */
  complete(messages: LlmMessage[], opts?: { temperature?: number }): Promise<string>;
  /** Document-aware QA over provided context. */
  answerWithContext(context: string, question: string, replyLang: string, sourceLang?: string): Promise<string>;
  /** Summarize the provided text. */
  summarize(
    text: string,
    opts: { style: "bullets" | "paragraph"; length: "short" | "medium" | "detailed"; targetLang: string },
  ): Promise<string>;
}

export interface AiEngines {
  translation: TranslationEngine;
  transcription: TranscriptionEngine;
  tts: TtsEngine;
  llm: LlmEngine;
}
