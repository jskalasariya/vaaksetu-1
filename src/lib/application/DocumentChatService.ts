/** DocumentChatService — chat (text or voice) with an uploaded document. */

import path from "path";
import { aiEngines, extractDocumentText } from "@/lib/infrastructure/ai/zai-adapter";
import { ChatRepository } from "@/lib/infrastructure/repositories/chat-repository";
import { saveOutput } from "@/lib/infrastructure/storage/file-storage";

export const DocumentChatService = {
  async createSession(opts: {
    title: string;
    sourceLang: string;
    targetLang: string;
    documentText?: string;
    documentName?: string;
    documentPath?: string;
  }): Promise<{ id: string }> {
    let context = opts.documentText ?? "";
    if (!context && opts.documentPath && opts.documentName) {
      context = await extractDocumentText(opts.documentPath, opts.documentName);
    }
    const session = await ChatRepository.createSession({
      title: opts.title || opts.documentName || "New document chat",
      sourceLang: opts.sourceLang,
      targetLang: opts.targetLang,
      documentText: context,
      documentName: opts.documentName ?? null,
      documentPath: opts.documentPath ?? null,
    });
    return { id: session.id };
  },

  async send(opts: {
    sessionId: string;
    question: string;
    /** Optional path to a voice-input audio file (ASR will transcribe it). */
    audioPath?: string;
    /** Whether to synthesize a spoken reply. */
    speakReply?: boolean;
  }): Promise<{ reply: string; replyAudioPath?: string }> {
    const session = await ChatRepository.getSession(opts.sessionId);
    if (!session) throw new Error("Chat session not found.");

    let question = opts.question;
    let audioPath: string | undefined = opts.audioPath;
    if (!question && audioPath) {
      const asr = await aiEngines.transcription.transcribe(audioPath);
      question = asr.text;
    }
    if (!question) throw new Error("No question provided.");

    await ChatRepository.addMessage({
      sessionId: session.id,
      role: "user",
      content: question,
      audioPath: audioPath ?? null,
    });

    const reply = await aiEngines.llm.answerWithContext(
      session.documentText ?? "",
      question,
      session.targetLang,
      session.sourceLang,
    );

    let replyAudioPath: string | undefined;
    if (opts.speakReply) {
      const audio = await aiEngines.tts.synthesize(reply, session.targetLang);
      replyAudioPath = await saveOutput(`chat-${session.id}`, `reply-${Date.now()}.mp3`, audio);
      await ChatRepository.updateSession(session.id, { lastAudio: replyAudioPath });
    }

    await ChatRepository.addMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      replyAudio: replyAudioPath ?? null,
    });

    return { reply, replyAudioPath };
  },

  /** Helper used by the upload route to store a voice-input file. */
  voiceInputPath: (sessionId: string, ext = "wav") =>
    path.join(process.cwd(), "storage", "chat-voice", `${sessionId}-${Date.now()}.${ext}`),
};
