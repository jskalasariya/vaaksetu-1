import { NextResponse } from "next/server";
import { getAiMode, remoteCredentials, setAiMode, type AiMode } from "@/lib/infrastructure/ai/ai-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: await getAiMode(), credentials: remoteCredentials() });
}

export async function PUT(request: Request) {
  const body = (await request.json().catch(() => null)) as { mode?: AiMode } | null;
  if (body?.mode !== "local" && body?.mode !== "remote") {
    return NextResponse.json({ error: "AI mode must be local or remote." }, { status: 400 });
  }

  await setAiMode(body.mode);
  return NextResponse.json({ mode: body.mode, credentials: remoteCredentials() });
}
