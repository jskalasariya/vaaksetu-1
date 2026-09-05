"use client";

import { useEffect, useState } from "react";
import { Cloud, Cpu, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type AiMode = "local" | "remote";

interface AiModeResponse {
  mode?: AiMode;
  credentials?: { bhashini?: boolean; gemini?: boolean; hf?: boolean };
}

export function AiModeToggle() {
  const [mode, setMode] = useState<AiMode>("local");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/settings/ai-mode")
      .then((response) => response.json() as Promise<AiModeResponse>)
      .then((data) => {
        if (!active) return;
        if (data.mode === "local" || data.mode === "remote") setMode(data.mode);
        setReady(Boolean(data.credentials?.bhashini || data.credentials?.gemini || data.credentials?.hf));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const toggleMode = async () => {
    const nextMode: AiMode = mode === "local" ? "remote" : "local";
    setSaving(true);
    try {
      const response = await fetch("/api/settings/ai-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      const data = (await response.json()) as AiModeResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Could not change AI mode");
      setMode(nextMode);
      setReady(Boolean(data.credentials?.bhashini || data.credentials?.gemini || data.credentials?.hf));
      if (nextMode === "remote" && !ready && !data.credentials?.bhashini && !data.credentials?.gemini && !data.credentials?.hf) {
        toast.warning("Remote mode selected, but no remote credentials are configured. Local fallback will be used.");
      } else {
        toast.success(`${nextMode === "local" ? "Local" : "Remote"} AI mode selected`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change AI mode");
    } finally {
      setSaving(false);
    }
  };

  const Icon = mode === "local" ? Cpu : Cloud;
  const label = mode === "local" ? "Local AI mode" : ready ? "Remote AI mode" : "Remote selected; local fallback";

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => void toggleMode()}
      disabled={saving}
      aria-label={label}
      title={`${label}. Click to switch.`}
      className="relative h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
    >
      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
      {mode === "remote" && !ready && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-amber-500" />}
    </Button>
  );
}
