import { db } from "@/lib/db";

export type AiMode = "local" | "remote";
export const AI_MODE_KEY = "AI_MODE";

export async function getAiMode(): Promise<AiMode> {
  const configured = process.env.AI_MODE?.trim().toLowerCase();
  if (configured === "remote" || configured === "local") return configured;

  const setting = await db.setting.findUnique({ where: { key: AI_MODE_KEY } });
  return setting?.value === "remote" ? "remote" : "local";
}

export async function setAiMode(mode: AiMode): Promise<void> {
  await db.setting.upsert({
    where: { key: AI_MODE_KEY },
    update: { value: mode },
    create: { key: AI_MODE_KEY, value: mode },
  });
}

export function remoteCredentials(): { bhashini: boolean; gemini: boolean; hf: boolean } {
  return {
    bhashini: Boolean(
      (process.env.BHASHINI_USER_ID || "").trim() &&
        (process.env.BHASHINI_API_KEY || "").trim(),
    ),
    gemini: Boolean(
      (process.env.GEMINI_API_KEY || process.env.NEXT_PUBLIC_GEMINI_API_KEY || "").trim(),
    ),
    hf: Boolean((process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN || "").trim()),
  };
}
