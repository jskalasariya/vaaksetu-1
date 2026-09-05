"use client";

import { useEffect, useState } from "react";
import {
  Settings,
  Globe,
  Cpu,
  ShieldCheck,
  HardDrive,
  Info,
  Building2,
  Server,
  CheckCircle2,
  Loader2,
  Wand2,
  FileText,
  Sparkles,
} from "lucide-react";
import { ViewHeader } from "../shared/view-header";
import { StatCard } from "../shared/stat-card";
import { useAppStore } from "../app-store";
import { LanguageSelect } from "../shared/language-select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";

interface Stats {
  totalJobs: number;
  statusCounts: Record<string, number>;
  kindCounts: Record<string, number>;
  fineTuneDatasets: number;
  fineTuneSamples: number;
  fineTuneJobsRunning: number;
}

const DEPLOYMENT_ROWS: { icon: typeof Globe; label: string; value: string }[] = [
  {
    icon: Building2,
    label: "Deployment",
    value: "On-premises (BAIF file server / standalone machines)",
  },
  {
    icon: Cpu,
    label: "Models",
    value: "IndicTrans2 · Whisper · AI4Bharat TTS · IndicLLM (all MIT)",
  },
  {
    icon: ShieldCheck,
    label: "Data residency",
    value: "100% on-prem — nothing leaves your network",
  },
  {
    icon: Server,
    label: "Desktop packaging",
    value: "Electron + electron-builder (see docs/BUILD.md for `bun run dist` → Windows .exe)",
  },
];

const StorageCard = () => {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((s) => setStats(s as Stats))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-lg border py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading storage…
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard
        icon={CheckCircle2}
        label="Total jobs"
        value={stats?.totalJobs ?? 0}
        hint="All-time"
      />
      <StatCard
        icon={Wand2}
        label="Fine-tune datasets"
        value={stats?.fineTuneDatasets ?? 0}
        hint={`${stats?.fineTuneJobsRunning ?? 0} training`}
        accent="accent"
      />
      <StatCard
        icon={FileText}
        label="Sample pairs"
        value={stats?.fineTuneSamples ?? 0}
        hint="Across all datasets"
        accent="muted"
      />
    </div>
  );
};

const PreferencesCard = () => {
  const {
    defaultSourceLang,
    defaultTargetLang,
    setDefaultSourceLang,
    setDefaultTargetLang,
    autoModel,
    setAutoModel,
  } = useAppStore();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Globe className="h-4 w-4 text-primary" /> Preferences
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pref-src" className="text-xs text-muted-foreground">
              Default source language
            </Label>
            <LanguageSelect
              id="pref-src"
              variant="source"
              value={defaultSourceLang}
              onChange={setDefaultSourceLang}
              className="w-full"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pref-tgt" className="text-xs text-muted-foreground">
              Default target language
            </Label>
            <LanguageSelect
              id="pref-tgt"
              variant="target"
              value={defaultTargetLang}
              onChange={setDefaultTargetLang}
              className="w-full"
            />
          </div>
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label htmlFor="auto-model" className="cursor-pointer text-sm">
              Auto-select model
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Pick the best engine per task (IndicTrans2 / Whisper / TTS / IndicLLM) automatically.
            </p>
          </div>
          <Switch id="auto-model" checked={autoModel} onCheckedChange={setAutoModel} />
        </div>
        <Separator />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <Label className="cursor-pointer text-sm">Guided tour</Label>
            <p className="text-[11px] text-muted-foreground">
              Replay the first-run onboarding walkthrough.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.dispatchEvent(new CustomEvent("vaak:restart-tour"))}
          >
            <Sparkles className="h-3.5 w-3.5" /> Restart tour
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Preferences are stored locally for this demo session.
        </p>
      </CardContent>
    </Card>
  );
};

const AiModeCard = () => {
  const [mode, setMode] = useState<"local" | "remote">("local");
  const [credentials, setCredentials] = useState({ bhashini: false, gemini: false, hf: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings/ai-mode")
      .then((response) => response.json())
      .then((data) => {
        if (data.mode === "local" || data.mode === "remote") setMode(data.mode);
        if (data.credentials) setCredentials(data.credentials);
      })
      .catch(() => undefined);
  }, []);

  const updateMode = async (nextMode: "local" | "remote") => {
    setMode(nextMode);
    setSaving(true);
    try {
      const response = await fetch("/api/settings/ai-mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      if (!response.ok) throw new Error("Could not save AI mode");
      const data = await response.json();
      setCredentials(data.credentials ?? credentials);
      toast.success(`${nextMode === "local" ? "Local" : "Remote"} AI mode selected`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save AI mode");
    } finally {
      setSaving(false);
    }
  };

  const remoteReady = credentials.bhashini || credentials.gemini || credentials.hf;

  return (
    <Card className={mode === "remote" && !remoteReady ? "border-amber-500/50" : undefined}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-primary" /> AI execution mode
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <RadioGroup value={mode} onValueChange={(value) => void updateMode(value as "local" | "remote")} className="grid gap-3 sm:grid-cols-2">
          <Label htmlFor="ai-mode-local" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <RadioGroupItem id="ai-mode-local" value="local" />
            <span><span className="block text-sm font-medium">Local / offline</span><span className="text-[11px] text-muted-foreground">Use the local AI service and system RAM.</span></span>
          </Label>
          <Label htmlFor="ai-mode-remote" className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <RadioGroupItem id="ai-mode-remote" value="remote" />
            <span><span className="block text-sm font-medium">Remote APIs</span><span className="text-[11px] text-muted-foreground">Use configured Bhashini, Gemini, or Hugging Face APIs first.</span></span>
          </Label>
        </RadioGroup>
        {mode === "remote" && !remoteReady && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-200">
            Remote mode is selected, but no remote credentials are configured. Requests will be logged and fall back to local AI.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground">{saving ? "Saving…" : "Mode is stored in the local database."}</p>
      </CardContent>
    </Card>
  );
};

const DeploymentCard = () => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        <Server className="h-4 w-4 text-primary" /> Deployment
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-3">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-[auto_1fr] sm:gap-x-4">
        {DEPLOYMENT_ROWS.map((row) => {
          const Icon = row.icon;
          return (
            <div
              key={row.label}
              className="contents"
            >
              <dt className="flex items-center gap-2 text-xs font-medium text-muted-foreground sm:py-1">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                {row.label}
              </dt>
              <dd className="text-sm sm:py-1">{row.value}</dd>
            </div>
          );
        })}
      </dl>
    </CardContent>
  </Card>
);

const AboutCard = () => (
  <Card>
    <CardHeader className="pb-3">
      <CardTitle className="flex items-center gap-2 text-base">
        <Info className="h-4 w-4 text-primary" /> About
      </CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      <div>
        <p className="text-lg font-semibold tracking-tight">
          VaakSetu · <span className="devanagari text-primary">वाक्सेतु</span>
        </p>
        <p className="text-xs text-muted-foreground">Version 1.0 · Tech for Good Hackathon</p>
      </div>
      <p className="text-sm text-muted-foreground">
        VaakSetu is an offline multilingual translation suite that bridges Marathi, Hindi and
        English across text, audio and video — built so field workers and extension officers can
        communicate without depending on cloud services or paid APIs.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {["Next.js", "TypeScript", "Tailwind", "shadcn/ui", "Prisma", "IndicTrans2", "Whisper"].map(
          (t) => (
            <Badge key={t} variant="secondary" className="text-[11px]">
              {t}
            </Badge>
          ),
        )}
      </div>
    </CardContent>
  </Card>
);

const StorageSection = () => (
  <div className="space-y-3">
    <div className="flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <HardDrive className="h-4 w-4 text-primary" /> Storage overview
      </h2>
      <Badge variant="secondary" className="text-[11px]">
        SQLite · on-prem
      </Badge>
    </div>
    <StorageCard />
  </div>
);

export function SettingsView() {
  return (
    <div className="space-y-6">
      <ViewHeader
        icon={Settings}
        title="Settings"
        nativeTitle="सेटिंग्ज"
        subtitle="Preferences, model behaviour and deployment information."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PreferencesCard />
        <DeploymentCard />
      </div>

      <AiModeCard />

      <AboutCard />

      <StorageSection />

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">Mission.</span> Bridge India&apos;s
            language divide with open-source AI that runs entirely on BAIF infrastructure — no data
            ever leaves the village office.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
