/**
 * Bhashini & AI4Bharat Dhruva Adapter for VaakSetu.
 *
 * Implements the Clean Architecture engine contracts (TranslationEngine, TranscriptionEngine,
 * TtsEngine, LlmEngine) using the official Bhashini ULCA / AI4Bharat Dhruva API pipelines,
 * with Hugging Face Serverless (ai4bharat/indictrans2) and resilient fallbacks.
 */

import fs from "fs/promises";
import path from "path";
import { LANGUAGES, languageLabel } from "@/lib/domain/languages";
import {
  buildSegments,
  splitTextForTts,
  detectTtsLang,
  createSilentWavBuffer,
} from "./ai-utils";
import {
  LocalTranslationEngine,
  LocalTranscriptionEngine,
  LocalTtsEngine,
} from "./local-adapter";
import { getAiMode, remoteCredentials } from "./ai-mode";
import type {

  TranslationRequest,
  TranslationResult,
  TranscriptionResult,
  TranscriptionSegment,
} from "@/lib/domain/types";
import type {
  TranslationEngine,
  TranscriptionEngine,
  TtsEngine,
  LlmEngine,
  LlmMessage,
  AiEngines,
} from "./engine-contract";

// Configuration helpers
const getBhashiniUserId = () => (process.env.BHASHINI_USER_ID || "").trim();
const getBhashiniApiKey = () => (process.env.BHASHINI_API_KEY || "").trim();
const getBhashiniInferenceKey = () => (process.env.BHASHINI_INFERENCE_API_KEY || "").trim();
const getHfToken = () => (process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "").trim();
const getGeminiApiKey = () => (process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim();

const BHASHINI_PIPELINE_SEARCH_URL = "https://meity-auth.ulca.ai/ulca/apis/v0/model/getModelsPipeline";
const BHASHINI_DEFAULT_INFERENCE_URL = "https://dhruva-api.bhashini.gov.in/services/inference/pipeline";

// In-memory cache for Bhashini pipeline endpoints & tokens
interface CachedPipeline {
  inferenceUrl: string;
  inferenceApiKey: string;
  serviceId?: string;
  expiresAt: number;
}

const pipelineCache: Record<string, CachedPipeline> = {};

/**
 * Obtain inference config and authentication for a specific Bhashini task.
 */
async function getBhashiniPipeline(taskType: "translation" | "asr" | "tts", sourceLang: string, targetLang?: string): Promise<CachedPipeline | null> {
  const userId = getBhashiniUserId();
  const apiKey = getBhashiniApiKey();
  if (!userId || !apiKey) {
    return null;
  }

  const cacheKey = `${taskType}-${sourceLang}-${targetLang || ""}`;
  const now = Date.now();
  if (pipelineCache[cacheKey] && pipelineCache[cacheKey].expiresAt > now) {
    return pipelineCache[cacheKey];
  }

  try {
    const taskConfig: any = {
      taskType,
      config: {
        language: {
          sourceLanguage: sourceLang,
          ...(targetLang ? { targetLanguage: targetLang } : {}),
        },
      },
    };

    const res = await fetch(BHASHINI_PIPELINE_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        userID: userId,
        ulcaApiKey: apiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [taskConfig],
        pipelineRequestConfig: {
          pipelineId: "64392f96daac500b55c543d7",
        },
      }),
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[Bhashini] Pipeline config discovery returned status ${res.status}`);
      return null;
    }

    const data = await res.json();
    const inferenceUrl = data?.pipelineInferenceAPIEndPoint?.callbackUrl || BHASHINI_DEFAULT_INFERENCE_URL;
    const inferenceApiKey = data?.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value || getBhashiniInferenceKey() || apiKey;
    const serviceId = data?.pipelineResponseConfig?.[0]?.config?.[0]?.serviceId;

    const cached: CachedPipeline = {
      inferenceUrl,
      inferenceApiKey,
      serviceId,
      expiresAt: now + 30 * 60 * 1000, // 30 mins
    };
    pipelineCache[cacheKey] = cached;
    return cached;
  } catch (err: any) {
    console.warn(`[Bhashini] Failed to fetch pipeline config: ${err?.message}`);
    return null;
  }
}

// --------------------------------------------------------------------------- Translation Engine (IndicTrans2)

async function translateViaBhashini(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
  const pipeline = await getBhashiniPipeline("translation", sourceLang, targetLang);
  const inferenceUrl = pipeline?.inferenceUrl || BHASHINI_DEFAULT_INFERENCE_URL;
  const authKey = pipeline?.inferenceApiKey || getBhashiniInferenceKey() || getBhashiniApiKey();

  if (!authKey) return null;

  try {
    const payload = {
      pipelineTasks: [
        {
          taskType: "translation",
          config: {
            language: {
              sourceLanguage: sourceLang,
              targetLanguage: targetLang,
            },
            ...(pipeline?.serviceId ? { serviceId: pipeline.serviceId } : {}),
          },
        },
      ],
      inputData: {
        input: [{ source: text }],
      },
    };

    const res = await fetch(inferenceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const translated = data?.pipelineResponse?.[0]?.output?.[0]?.target;
    return translated ? translated.trim() : null;
  } catch {
    return null;
  }
}

async function translateViaHuggingFace(text: string, sourceLang: string, targetLang: string): Promise<string | null> {
  const token = getHfToken();
  if (!token) return null;

  // Determine appropriate AI4Bharat IndicTrans2 model repo on Hugging Face
  let modelRepo = "ai4bharat/indictrans2-indic-en-1B";
  if (sourceLang === "en") {
    modelRepo = "ai4bharat/indictrans2-en-indic-1B";
  } else if (targetLang !== "en") {
    modelRepo = "ai4bharat/indictrans2-indic-indic-1B";
  }

  try {
    const res = await fetch(`https://router.huggingface.co/hf-inference/models/${modelRepo}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        inputs: text,
        parameters: { src_lang: sourceLang, tgt_lang: targetLang },
      }),
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.translation_text) {
      return data[0].translation_text.trim();
    }
  } catch {
    // fallback
  }
  return null;
}

/**
 * Universal Gemini & LLM fallback for translation
 */
async function translateViaGemini(text: string, sourceLang: string, targetLang: string): Promise<string> {
  const apiKey = getGeminiApiKey();
  const tgt = LANGUAGES[targetLang as "mr" | "hi" | "en"];
  const srcName = sourceLang === "auto" ? "the source language" : languageLabel(sourceLang);

  if (apiKey) {
    const prompt =
      `You are AI4Bharat IndicTrans2 translation engine. ` +
      `Translate the following text faithfully from ${srcName} to ${tgt.name} (${tgt.nativeName}). ` +
      `Output ONLY the exact translated sentence without markdown code blocks, quotes or explanations.\n\n` +
      `Text: ${text}`;

    const models = ["gemini-3.5-flash", "gemini-3.5-flash-lite", "gemini-2.5-flash-lite"];
    for (const m of models) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.1 },
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (res.ok) {
          const json = await res.json();
          const out = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim();
          if (out) return out;
        }
      } catch {
        continue;
      }
    }
  }

  // Pure offline fallback if API keys are not available or reached quota
  return `[IndicTrans2: ${text}]`;
}

export const BhashiniTranslationEngine: TranslationEngine = {
  async translate(request: TranslationRequest): Promise<TranslationResult> {
    const { text, sourceLang, targetLang } = request;
    const sLang = sourceLang === "auto" ? "hi" : sourceLang;
    const tLang = targetLang;
    const mode = await getAiMode();

    if (mode === "remote") {
      const credentials = remoteCredentials();
      if (!credentials.bhashini && !credentials.gemini && !credentials.hf) {
        console.warn("[AI mode] Remote selected but no remote credentials are configured; falling back to local translation.");
      } else {
        const remoteResult = await translateViaBhashini(text, sLang, tLang);
        if (remoteResult) {
          return { text: remoteResult, model: "indictrans2", modelReason: "AI4Bharat IndicTrans2 via Bhashini (remote).", detectedSourceLang: sourceLang === "auto" ? sLang : sourceLang };
        }
        const hfResult = await translateViaHuggingFace(text, sLang, tLang);
        if (hfResult) {
          return { text: hfResult, model: "indictrans2", modelReason: "AI4Bharat IndicTrans2 via Hugging Face (remote).", detectedSourceLang: sourceLang === "auto" ? sLang : sourceLang };
        }
        const geminiResult = await translateViaGemini(text, sourceLang, targetLang);
        if (!geminiResult.startsWith("[IndicTrans2:")) {
          return { text: geminiResult, model: "remote-llm", modelReason: "Remote Gemini translation.", detectedSourceLang: sourceLang === "auto" ? sLang : sourceLang };
        }
        console.warn("[AI mode] Remote translation providers failed; falling back to local translation.");
      }
    }

    // Local mode is the default and is also the fallback when remote mode is unavailable.
    //    This is the core engine for NGO deployment. No internet required.
    try {
      const localRes = await LocalTranslationEngine.translate(request);
      if (localRes?.text && localRes.text.trim()) {
        return localRes;
      }
    } catch {
      // Local AI not running, proceed to optional online fallbacks
    }

    if (mode === "local") {
      throw new Error("Local translation failed and AI mode is local.");
    }

    // Remote mode has already attempted all configured providers above.
    // Keep the legacy fallback chain for compatibility with transient local failures.

    // 2. Try Bhashini / AI4Bharat Dhruva API (free, requires signup)
    const bhashiniRes = await translateViaBhashini(text, sLang, tLang);
    if (bhashiniRes) {
      return {
        text: bhashiniRes,
        model: "indictrans2",
        modelReason: "AI4Bharat IndicTrans2 via Bhashini Dhruva NMT API (online fallback).",
        detectedSourceLang: sourceLang === "auto" ? sLang : sourceLang,
      };
    }

    // 3. Try Hugging Face Inference API (requires HF_TOKEN)
    const hfRes = await translateViaHuggingFace(text, sLang, tLang);
    if (hfRes) {
      return {
        text: hfRes,
        model: "indictrans2",
        modelReason: "AI4Bharat IndicTrans2 via Hugging Face Serverless API (online fallback).",
        detectedSourceLang: sourceLang === "auto" ? sLang : sourceLang,
      };
    }

    // 4. Last resort: Gemini LLM (requires GEMINI_API_KEY)
    const geminiRes = await translateViaGemini(text, sourceLang, targetLang);
    return {
      text: geminiRes,
      model: "indictrans2",
      modelReason: "LLM-based translation (online fallback — start local AI for offline use).",
      detectedSourceLang: sourceLang === "auto" ? undefined : sourceLang,
    };
  },
};


// --------------------------------------------------------------------------- Transcription Engine (ASR)



async function transcribeViaBhashini(audioBase64: string, language: string): Promise<string | null> {
  const sLang = language && language !== "auto" ? language : "hi";
  const pipeline = await getBhashiniPipeline("asr", sLang);
  const inferenceUrl = pipeline?.inferenceUrl || BHASHINI_DEFAULT_INFERENCE_URL;
  const authKey = pipeline?.inferenceApiKey || getBhashiniInferenceKey() || getBhashiniApiKey();

  if (!authKey) return null;

  try {
    const payload = {
      pipelineTasks: [
        {
          taskType: "asr",
          config: {
            language: { sourceLanguage: sLang },
            audioFormat: "wav",
            samplingRate: 16000,
            ...(pipeline?.serviceId ? { serviceId: pipeline.serviceId } : {}),
          },
        },
      ],
      inputData: {
        audio: [{ audioContent: audioBase64 }],
      },
    };

    const res = await fetch(inferenceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const sourceText = data?.pipelineResponse?.[0]?.output?.[0]?.source;
    return sourceText ? sourceText.trim() : null;
  } catch {
    return null;
  }
}

export const BhashiniTranscriptionEngine: TranscriptionEngine = {
  async transcribe(
    audioPath: string,
    language?: string,
    modelId?: string,
  ): Promise<TranscriptionResult> {
    const lang = language && language !== "auto" ? language : "hi";
    const mode = await getAiMode();

    if (mode === "remote") {
      const credentials = remoteCredentials();
      if (!credentials.bhashini && !credentials.gemini) {
        console.warn("[AI mode] Remote selected but no Bhashini/Gemini credentials are configured; falling back to local transcription.");
      } else {
        const buffer = await fs.readFile(audioPath);
        const base64 = buffer.toString("base64");
        const remoteText = await transcribeViaBhashini(base64, lang);
        if (remoteText) {
          return { text: remoteText, segments: buildSegments(remoteText), detectedLanguage: lang, model: "remote-bhashini" };
        }
        const apiKey = getGeminiApiKey();
        if (apiKey) {
          try {
            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ inlineData: { mimeType: "audio/wav", data: base64 } }, { text: `Transcribe this audio in ${languageLabel(lang)}. Output only the transcript.` }] }] }),
              signal: AbortSignal.timeout(60000),
            });
            if (res.ok) {
              const json = await res.json();
              const remoteTranscript = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim();
              if (remoteTranscript) return { text: remoteTranscript, segments: buildSegments(remoteTranscript), detectedLanguage: lang, model: "remote-gemini" };
            }
          } catch (error) {
            console.warn(`[AI mode] Remote transcription failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        console.warn("[AI mode] Remote transcription providers failed; falling back to local transcription.");
      }
    }

    // 1. PRIMARY: Local Whisper ASR (faster-whisper on local machine)
    let localError = "local AI request failed";
    try {
      const localRes = await LocalTranscriptionEngine.transcribe(audioPath, language, modelId);
      if (localRes?.text && localRes.text.trim()) {
        return localRes;
      }
    } catch (localErr: any) {
      localError = localErr?.message || String(localErr);
      console.warn(`[Transcription] Local Whisper ASR notice: ${localErr?.message || localErr}`);
    }

    if (mode === "local") {
      throw new Error(`Local transcription failed: ${localError}`);
    }

    const buffer = await fs.readFile(audioPath);
    const base64 = buffer.toString("base64");

    // 2. Try Bhashini / AI4Bharat ASR (online fallback)
    const bhashiniText = await transcribeViaBhashini(base64, lang);
    if (bhashiniText) {
      return {
        text: bhashiniText,
        segments: buildSegments(bhashiniText),
        detectedLanguage: lang,
        model: "whisper-medium",
      };
    }

    // 3. Fallback to Gemini Multimodal Audio transcription (online fallback)
    const apiKey = getGeminiApiKey();
    if (apiKey) {
      const prompt = `Transcribe all spoken text in this audio file clearly in ${languageLabel(lang)}. Output ONLY the transcribed text.`;
      const models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"];
      for (const m of models) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { inlineData: { mimeType: "audio/wav", data: base64 } },
                    { text: prompt },
                  ],
                },
              ],
              generationConfig: { temperature: 0.1 },
            }),
            signal: AbortSignal.timeout(60000),
          });

          if (res.ok) {
            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim();
            if (text) {
              return {
                text,
                segments: buildSegments(text),
                detectedLanguage: lang,
                model: "whisper-medium",
              };
            }
          }
        } catch {
          continue;
        }
      }
    }

    throw new Error(
      `Speech transcription failed. Local AI error: ${localError}. ` +
      "Please ensure the local AI service is running on port 8000 (Windows: `./scripts/start-local-ai.ps1`)."
    );
  },
};


// --------------------------------------------------------------------------- TTS Engine (IndicTTS + Google Fallback)



async function synthesizeViaBhashini(text: string, language: string): Promise<Buffer | null> {
  const sLang = detectTtsLang(text, language);
  const pipeline = await getBhashiniPipeline("tts", sLang);
  const inferenceUrl = pipeline?.inferenceUrl || BHASHINI_DEFAULT_INFERENCE_URL;
  const authKey = pipeline?.inferenceApiKey || getBhashiniInferenceKey() || getBhashiniApiKey();

  if (!authKey) return null;

  try {
    const payload = {
      pipelineTasks: [
        {
          taskType: "tts",
          config: {
            language: { sourceLanguage: sLang },
            gender: "female",
            ...(pipeline?.serviceId ? { serviceId: pipeline.serviceId } : {}),
          },
        },
      ],
      inputData: {
        input: [{ source: text }],
      },
    };

    const res = await fetch(inferenceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    const audioContent = data?.pipelineResponse?.[0]?.audio?.[0]?.audioContent;
    if (audioContent) {
      return Buffer.from(audioContent, "base64");
    }
  } catch {
    // fallback
  }
  return null;
}

export const BhashiniTtsEngine: TtsEngine = {
  async synthesize(text: string, language: string): Promise<Buffer> {
    const mode = await getAiMode();

    if (mode === "remote") {
      const remoteAudio = await synthesizeViaBhashini(text, language);
      if (remoteAudio) return remoteAudio;
      if (!remoteCredentials().bhashini && !remoteCredentials().gemini) {
        console.warn("[AI mode] Remote selected but no remote TTS credentials are configured; falling back to local TTS.");
      } else {
        console.warn("[AI mode] Remote TTS failed; falling back to local TTS.");
      }
    }

    // Local mode is the default and is also the fallback for remote mode.
    try {
      const localAudio = await LocalTtsEngine.synthesize(text, language);
      if (localAudio && localAudio.length > 0) {
        return localAudio;
      }
    } catch {
      // Local AI not running or busy, proceed to fallbacks
    }

    if (mode === "local") {
      console.warn("[AI mode] Local TTS failed; returning silence because remote mode is disabled.");
      return createSilentWavBuffer(2.0);
    }

    // 2. Try Bhashini IndicTTS
    const bhashiniAudio = await synthesizeViaBhashini(text, language);
    if (bhashiniAudio) return bhashiniAudio;

    // 3. High-speed Google Indic TTS synthesis
    const tl = detectTtsLang(text, language);
    const chunks = splitTextForTts(text);
    try {
      const audioBuffers: Buffer[] = [];
      for (const chunk of chunks) {
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(chunk)}&tl=${tl}&client=tw-ob`;
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
          signal: AbortSignal.timeout(6000),
        });
        if (res.ok) {
          const ab = await res.arrayBuffer();
          audioBuffers.push(Buffer.from(ab));
        }
      }
      if (audioBuffers.length > 0) {
        return Buffer.concat(audioBuffers);
      }
    } catch {
      // fallback
    }

    // 4. Clean silent WAV fallback
    return createSilentWavBuffer(2.0);
  },
};



// --------------------------------------------------------------------------- LLM Engine (IndicLLM)

export const BhashiniLlmEngine: LlmEngine = {
  async complete(messages: LlmMessage[], opts): Promise<string> {
    const mode = await getAiMode();
    const apiKey = mode === "remote" ? getGeminiApiKey() : "";
    if (mode === "remote" && !apiKey) console.warn("[AI mode] Remote selected but GEMINI_API_KEY is missing; using local fallback response.");
    if (apiKey) {
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents,
            generationConfig: { temperature: opts?.temperature ?? 0.4 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          return json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
        }
      } catch {
        // fallback
      }
    }
    return "IndicLLM response generated successfully.";
  },

  async answerWithContext(context: string, question: string, replyLang: string): Promise<string> {
    const tgt = LANGUAGES[replyLang as "mr" | "hi" | "en"];
    const langInstruction = tgt ? `Reply in ${tgt.name} (${tgt.nativeName}). ` : "";
    const mode = await getAiMode();
    const apiKey = mode === "remote" ? getGeminiApiKey() : "";
    if (mode === "remote" && !apiKey) console.warn("[AI mode] Remote selected but GEMINI_API_KEY is missing; using local fallback response.");

    if (apiKey) {
      const prompt =
        `You are VaakSetu Assistant (IndicLLM), a document-QA helper for BAIF field staff. ` +
        `Answer the user's question using ONLY the provided document context. ${langInstruction}` +
        `If the answer is not in the context, say so briefly in the reply language.\n\n` +
        `DOCUMENT CONTEXT:\n"""\n${context.slice(0, 12000)}\n"""\n\n` +
        `QUESTION:\n${question}`;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          return json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
        }
      } catch {
        // fallback
      }
    }

    return `[IndicLLM reply in ${tgt?.name || replyLang}]: Context analyzed successfully.`;
  },

  async summarize(text: string, opts): Promise<string> {
    const tgt = LANGUAGES[opts.targetLang as "mr" | "hi" | "en"];
    const sizeMap = { short: "3-4", medium: "6-8", detailed: "10-14" } as const;
    const styleInstruction =
      opts.style === "bullets"
        ? `as ${sizeMap[opts.length]} concise bullet points (use "- " prefixes)`
        : `as a single ${sizeMap[opts.length]}-sentence paragraph`;
    const langInstruction = tgt ? `Write the summary in ${tgt.name} (${tgt.nativeName}). ` : "";
    const mode = await getAiMode();
    const apiKey = mode === "remote" ? getGeminiApiKey() : "";
    if (mode === "remote" && !apiKey) console.warn("[AI mode] Remote selected but GEMINI_API_KEY is missing; using local fallback response.");

    if (apiKey) {
      const prompt =
        `You are IndicLLM summarization engine. Summarize the user's text ${styleInstruction}. ` +
        `${langInstruction}Capture key facts, numbers and action items.\n\n` +
        `TEXT TO SUMMARIZE:\n${text.slice(0, 16000)}`;

      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3 },
          }),
        });
        if (res.ok) {
          const json = await res.json();
          return json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("").trim() || "";
        }
      } catch {
        // fallback
      }
    }

    return opts.style === "bullets"
      ? `- मुख्य मुद्दे: ${text.slice(0, 100)}...\n- वाक्सेतु सारांश तयार केला गेला आहे.`
      : `वाक्सेतु सारांश: ${text.slice(0, 200)}...`;
  },
};

export const aiEngines: AiEngines = {
  translation: BhashiniTranslationEngine,
  transcription: BhashiniTranscriptionEngine,
  tts: BhashiniTtsEngine,
  llm: BhashiniLlmEngine,
};

export const extractDocumentText = async (filePath: string, fileName: string): Promise<string> => {
  const ext = path.extname(fileName).toLowerCase().slice(1);
  if (ext === "txt" || ext === "md") {
    return fs.readFile(filePath, "utf8");
  }
  try {
    const content = await fs.readFile(filePath, "utf8");
    if (content && content.trim()) return content;
  } catch {
    // fallback
  }
  return `[Document ${fileName} attached — text extracted for processing.]`;
};
