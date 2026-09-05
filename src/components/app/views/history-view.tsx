"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  History,
  Search,
  Filter,
  Eye,
  Trash2,
  FileText,
  FileAudio,
  Captions,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowRight,
  Download,
  Star,
  Columns2,
  RotateCw,
  ThumbsUp,
  ThumbsDown,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { ViewHeader } from "../shared/view-header";
import { EmptyState } from "../shared/empty-state";
import { StatCard } from "../shared/stat-card";
import { ModelBadge } from "../shared/model-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { languageLabel } from "@/lib/domain/languages";
import type { JobRecord } from "@/lib/infrastructure/repositories/job-repository";

/** JobRecord as received over JSON (dates serialised to ISO strings). */
type JobDto = Omit<JobRecord, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

const KIND_LABEL: Record<string, string> = {
  text: "Text",
  media: "Media",
  summary: "Summary",
  convert: "Convert",
};

const STATUS_STYLE: Record<string, string> = {
  completed: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  running: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  failed: "bg-destructive/15 text-destructive",
  queued: "bg-muted text-muted-foreground",
  canceled: "bg-muted text-muted-foreground",
};

const KIND_STYLE: Record<string, string> = {
  text: "bg-primary/10 text-primary",
  media: "bg-accent text-accent-foreground",
  summary: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  convert: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

const fmtBytes = (b: number | null) => {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};

const fmtDuration = (s: number | null) => {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

const truncate = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s);

const inputLabel = (job: JobDto) =>
  job.inputName ?? (job.inputText ? truncate(job.inputText) : "Untitled job");

const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** Escape a value for CSV (RFC 4180: quote fields containing commas, quotes, newlines). */
const csvCell = (v: unknown): string => {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

/** Export an array of jobs as a CSV file (client-side Blob download). */
const exportJobsAsCsv = (jobs: JobDto[]) => {
  const headers = [
    "id", "kind", "status", "starred", "rating", "sourceLang", "targetLang",
    "inputName", "inputText", "transcript", "outputText", "summary",
    "model", "modelReason", "durationSec", "createdAt",
  ];
  const rows = jobs.map((j) => [
    j.id, j.kind, j.status, j.starred ? "yes" : "no", j.rating ?? "", j.sourceLang, j.targetLang,
    j.inputName ?? "", j.inputText ?? "", j.transcript ?? "", j.outputText ?? "", j.summary ?? "",
    j.model ?? "", j.modelReason ?? "", j.durationSec ?? "", j.createdAt,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaaksetu-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Export starred jobs as a human-readable bundled text file. */
const exportStarredBundle = (jobs: JobDto[]) => {
  const starred = jobs.filter((j) => j.starred);
  if (starred.length === 0) return;
  const lines: string[] = [
    "VaakSetu — Starred Translations Bundle",
    `Generated: ${new Date().toISOString()}`,
    `Total entries: ${starred.length}`,
    "=".repeat(60),
    "",
  ];
  starred.forEach((job, i) => {
    lines.push(`[${i + 1}/${starred.length}] ${KIND_LABEL[job.kind] ?? job.kind} · ${job.sourceLang} → ${job.targetLang}`);
    if (job.inputName) lines.push(`File: ${job.inputName}`);
    lines.push(`Created: ${new Date(job.createdAt).toLocaleString()}`);
    if (job.model) lines.push(`Model: ${job.model}`);
    if (job.rating) lines.push(`Rating: ${job.rating === "up" ? "👍 Good" : "👎 Needs work"}`);
    lines.push("-".repeat(40));
    if (job.inputText) {
      lines.push("SOURCE:");
      lines.push(job.inputText);
      lines.push("");
    }
    if (job.transcript && job.transcript !== job.inputText) {
      lines.push("TRANSCRIPT:");
      lines.push(job.transcript);
      lines.push("");
    }
    if (job.outputText) {
      lines.push("TRANSLATION:");
      lines.push(job.outputText);
      lines.push("");
    }
    if (job.summary) {
      lines.push("SUMMARY:");
      lines.push(job.summary);
      lines.push("");
    }
    lines.push("=".repeat(60));
    lines.push("");
  });
  const content = lines.join("\n");
  const blob = new Blob(["\uFEFF" + content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vaaksetu-starred-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const downloadText = (filename: string, content: string) => {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};

const Section = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="space-y-1.5">
    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-sm scroll-area-thin">
      {children}
    </div>
  </div>
);

const Detail = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="space-y-0.5">
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
    <div className="text-sm font-medium">{value}</div>
  </div>
);

const TextDownloadButton = ({
  label,
  filename,
  content,
  icon: Icon,
}: {
  label: string;
  filename: string;
  content: string;
  icon: LucideIcon;
}) => (
  <Button
    size="sm"
    variant="outline"
    className="gap-1.5"
    onClick={() => downloadText(filename, content)}
  >
    <Icon className="h-4 w-4" /> {label}
  </Button>
);

/** Side-by-side comparison of source text vs. translated output. */
const CompareView = ({ job }: { job: JobDto }) => {
  const sourceText = job.inputText ?? job.transcript ?? "";
  const targetText = job.outputText ?? "";
  if (!sourceText || !targetText) return null;

  const sourceSentences = sourceText.split(/(?<=[।.!?])\s+/).filter(Boolean);
  const targetSentences = targetText.split(/(?<=[।.!?])\s+/).filter(Boolean);
  const maxLines = Math.max(sourceSentences.length, targetSentences.length, 1);

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Side-by-side comparison
      </p>
      <div className="grid grid-cols-2 gap-2 rounded-lg border p-2">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1">
          {languageLabel(job.sourceLang)}
        </div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground px-1">
          {languageLabel(job.targetLang)}
        </div>
        <div className="col-span-2 h-px bg-border" />
        {Array.from({ length: maxLines }).map((_, i) => (
          <div key={i} className="contents">
            <div
              className="rounded px-2 py-1.5 text-sm leading-relaxed"
              lang={job.sourceLang === "auto" ? undefined : job.sourceLang}
            >
              {sourceSentences[i] ?? <span className="text-muted-foreground/40">—</span>}
            </div>
            <div
              className="rounded bg-muted/30 px-2 py-1.5 text-sm leading-relaxed devanagari"
              lang={job.targetLang}
            >
              {targetSentences[i] ?? <span className="text-muted-foreground/40">—</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Re-translate the source text into a different target language. */
const RetranslateButton = ({ job }: { job: JobDto }) => {
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const canRetranslate = (job.kind === "text" || job.kind === "summary") && job.inputText;

  if (!canRetranslate) return null;

  const run = async () => {
    if (!target || !job.inputText) return;
    setBusy(true);
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: job.inputText,
          sourceLang: job.sourceLang,
          targetLang: target,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Re-translation failed");
      toast.success(`Re-translated to ${target.toUpperCase()} — see History.`);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("job-deleted"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Re-translation failed");
    } finally {
      setBusy(false);
    }
  };

  const targets = ["hi", "mr", "en"].filter((t) => t !== job.targetLang);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        size="sm"
        variant="outline"
        className="gap-1.5"
        onClick={() => setOpen(true)}
      >
        <RotateCw className="h-4 w-4" /> Re-translate
      </Button>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCw className="h-4 w-4 text-primary" /> Re-translate
          </DialogTitle>
          <DialogDescription>
            Translate the original source text into a different language. The new translation will appear in History.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="text-xs text-muted-foreground">Translate to:</p>
          <div className="flex gap-2">
            {targets.map((t) => (
              <Button
                key={t}
                variant={target === t ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setTarget(t)}
              >
                {t.toUpperCase()}
              </Button>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
          <Button size="sm" disabled={!target || busy} onClick={run} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Translate
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const JobDetailDialog = ({
  job,
  onClose,
}: {
  job: JobDto | null;
  onClose: () => void;
}) => {
  const hasAnyOutput = job && (
    job.outputAudio || job.outputSrt || job.outputVtt || job.outputText || job.summary
  );
  const mediaVideoName = job?.inputPath ? `source_${basename(job.inputPath)}` : null;
  return (
    <Dialog open={!!job} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2 pr-6">
            {job && (
              <Badge variant="outline" className={KIND_STYLE[job.kind] ?? ""}>
                {KIND_LABEL[job.kind] ?? job.kind}
              </Badge>
            )}
            <span className="truncate">{job ? inputLabel(job) : "Job details"}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            {job && (
              <>
                <span>
                  {languageLabel(job.sourceLang)} <ArrowRight className="inline h-3 w-3" />{" "}
                  {languageLabel(job.targetLang)}
                </span>
                {job.model && <ModelBadge modelId={job.model} />}
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {job && (
          <ScrollArea className="-mx-1 flex-1 px-1 scroll-area-thin">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Detail
                  label="Status"
                  value={
                    <Badge className={STATUS_STYLE[job.status] ?? STATUS_STYLE.queued}>
                      {job.status}
                    </Badge>
                  }
                />
                <Detail label="Duration" value={fmtDuration(job.durationSec)} />
                <Detail label="Input size" value={fmtBytes(job.inputSize)} />
                <Detail
                  label="Created"
                  value={formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
                />
              </div>

              {job.inputText && <Section label="Input text">{job.inputText}</Section>}
              {job.transcript && <Section label="Transcript (ASR)">{job.transcript}</Section>}
              {job.outputText && <Section label="Translated output">{job.outputText}</Section>}
              {job.summary && <Section label="Summary">{job.summary}</Section>}

              {job.kind === "media" && job.status === "completed" && job.inputName && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Recorded video
                  </p>
                  <video
                    controls
                    preload="metadata"
                    className="aspect-video w-full rounded-lg border bg-black"
                    src={mediaVideoName ? `/api/download/${job.id}/${mediaVideoName}` : undefined}
                  >
                    Your browser does not support video playback.
                  </video>
                </div>
              )}

              {/* Side-by-side comparison (only when both source + output exist) */}
              {job.inputText && job.outputText && <CompareView job={job} />}

              {job.modelReason && (
                <Section label="Model selection reason">{job.modelReason}</Section>
              )}
              {job.error && (
                <Section label="Error">
                  <span className="text-destructive">{job.error}</span>
                </Section>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Downloads & actions
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <RetranslateButton job={job} />
                  <RatingButtons
                    jobId={job.id}
                    rating={job.rating}
                    onRated={() => window.dispatchEvent(new CustomEvent("job-deleted"))}
                  />
                  {job.outputAudio && (
                    <Button asChild size="sm" variant="outline" className="gap-1.5">
                      <a
                        href={`/api/download/${job.id}/${basename(job.outputAudio)}`}
                        download
                      >
                        <FileAudio className="h-4 w-4" /> Audio
                      </a>
                    </Button>
                  )}
                  {job.outputSrt && (
                    <TextDownloadButton
                      label="SRT"
                      filename={`${job.id}.srt`}
                      content={job.outputSrt}
                      icon={Captions}
                    />
                  )}
                  {job.outputVtt && (
                    <TextDownloadButton
                      label="VTT"
                      filename={`${job.id}.vtt`}
                      content={job.outputVtt}
                      icon={Captions}
                    />
                  )}
                  {job.outputText && (
                    <TextDownloadButton
                      label="Text"
                      filename={`${job.id}.txt`}
                      content={job.outputText}
                      icon={FileText}
                    />
                  )}
                  {job.summary && (
                    <TextDownloadButton
                      label="Summary"
                      filename={`${job.id}-summary.txt`}
                      content={job.summary}
                      icon={FileText}
                    />
                  )}
                  {!hasAnyOutput && (
                    <p className="text-xs text-muted-foreground">No outputs available for this job.</p>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
};

/** Thumbs-up / thumbs-down rating buttons. */
const RatingButtons = ({
  jobId,
  rating,
  onRated,
}: {
  jobId: string;
  rating: string | null;
  onRated: () => void;
}) => {
  const [busy, setBusy] = useState(false);

  const rate = async (value: "up" | "down") => {
    setBusy(true);
    try {
      // Toggle off if clicking the same rating.
      const newRating = rating === value ? null : value;
      const res = await fetch(`/api/jobs/${jobId}/rate`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: newRating }),
      });
      if (!res.ok) throw new Error("Failed to rate");
      toast.success(newRating ? `Marked as ${newRating === "up" ? "good" : "needs improvement"}` : "Rating cleared");
      onRated();
    } catch {
      toast.error("Failed to update rating");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => rate("up")}
        disabled={busy}
        aria-label="Good translation"
        title="Good translation"
      >
        <ThumbsUp className={`h-4 w-4 ${rating === "up" ? "fill-emerald-500 text-emerald-600" : "text-muted-foreground"}`} />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => rate("down")}
        disabled={busy}
        aria-label="Needs improvement"
        title="Needs improvement"
      >
        <ThumbsDown className={`h-4 w-4 ${rating === "down" ? "fill-rose-500 text-rose-600" : "text-muted-foreground"}`} />
      </Button>
    </div>
  );
};

const StarButton = ({
  jobId,
  starred,
  onToggled,
}: {
  jobId: string;
  starred: boolean;
  onToggled: () => void;
}) => {
  const [busy, setBusy] = useState(false);
  const handleToggle = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/star`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: !starred }),
      });
      if (!res.ok) throw new Error("Failed to toggle star");
      toast.success(starred ? "Removed from favorites" : "Added to favorites");
      onToggled();
    } catch {
      toast.error("Failed to toggle favorite");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={handleToggle}
      disabled={busy}
      aria-label={starred ? "Remove from favorites" : "Add to favorites"}
      title={starred ? "Remove from favorites" : "Add to favorites"}
    >
      <Star
        className={`h-4 w-4 ${starred ? "fill-amber-400 text-amber-500" : "text-muted-foreground"}`}
      />
    </Button>
  );
};

const DeleteJobButton = ({
  jobId,
  onDeleted,
}: {
  jobId: string;
  onDeleted: () => void;
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Job deleted");
      onDeleted();
    } catch {
      toast.error("Failed to delete job");
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
          aria-label="Delete job"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this job?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently remove the job and its generated outputs. This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void handleDelete();
            }}
            disabled={busy}
            className="gap-1.5 bg-destructive text-white hover:bg-destructive/90"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};

const HistoryRow = ({ job, onView }: { job: JobDto; onView: () => void }) => (
  <TableRow className={`table-row-hover ${job.starred ? "bg-amber-50/40 dark:bg-amber-950/10" : ""}`}>
    <TableCell>
      <div className="flex items-center gap-1.5">
        {job.starred && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-500" />}
        <Badge variant="outline" className={KIND_STYLE[job.kind] ?? ""}>
          {KIND_LABEL[job.kind] ?? job.kind}
        </Badge>
      </div>
    </TableCell>
    <TableCell className="whitespace-nowrap text-sm font-medium">
      {languageLabel(job.sourceLang)}{" "}
      <ArrowRight className="inline h-3 w-3 text-muted-foreground" />{" "}
      {languageLabel(job.targetLang)}
    </TableCell>
    <TableCell
      className="max-w-[260px] truncate text-sm text-muted-foreground"
      title={job.inputName ?? job.inputText ?? ""}
    >
      {inputLabel(job)}
    </TableCell>
    <TableCell>
      <Badge className={STATUS_STYLE[job.status] ?? STATUS_STYLE.queued}>{job.status}</Badge>
    </TableCell>
    <TableCell>
      {job.model ? <ModelBadge modelId={job.model} /> : <span className="text-xs text-muted-foreground">—</span>}
    </TableCell>
    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
      {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
    </TableCell>
    <TableCell className="text-right">
      <div className="flex items-center justify-end gap-1">
        <StarButton
          jobId={job.id}
          starred={job.starred}
          onToggled={() => window.dispatchEvent(new CustomEvent("job-deleted"))}
        />
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onView} aria-label="View details">
          <Eye className="h-4 w-4" />
        </Button>
        <DeleteJobButton jobId={job.id} onDeleted={() => window.dispatchEvent(new CustomEvent("job-deleted"))} />
      </div>
    </TableCell>
  </TableRow>
);

const HistoryCard = ({ job, onView }: { job: JobDto; onView: () => void }) => (
  <Card>
    <CardContent className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={KIND_STYLE[job.kind] ?? ""}>
              {KIND_LABEL[job.kind] ?? job.kind}
            </Badge>
            <Badge className={STATUS_STYLE[job.status] ?? STATUS_STYLE.queued}>{job.status}</Badge>
          </div>
          <p className="truncate text-sm font-medium">{inputLabel(job)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {languageLabel(job.sourceLang)} → {languageLabel(job.targetLang)} ·{" "}
            {formatDistanceToNow(new Date(job.createdAt), { addSuffix: true })}
          </p>
        </div>
        {job.model && <ModelBadge modelId={job.model} />}
      </div>
      <div className="flex items-center justify-end gap-1">
        <StarButton
          jobId={job.id}
          starred={job.starred}
          onToggled={() => window.dispatchEvent(new CustomEvent("job-deleted"))}
        />
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onView}>
          <Eye className="h-4 w-4" /> View
        </Button>
        <DeleteJobButton jobId={job.id} onDeleted={() => window.dispatchEvent(new CustomEvent("job-deleted"))} />
      </div>
    </CardContent>
  </Card>
);

export function HistoryView() {
  const [jobs, setJobs] = useState<JobDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [starredOnly, setStarredOnly] = useState(false);
  const [detailJob, setDetailJob] = useState<JobDto | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (kind !== "all") params.set("kind", kind);
      if (status !== "all") params.set("status", status);
      if (debouncedQ) params.set("q", debouncedQ);
      if (starredOnly) params.set("starred", "true");
      params.set("limit", "200");
      const res = await fetch(`/api/jobs?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load");
      const data = (await res.json()) as { jobs: JobDto[] };
      setJobs(data.jobs ?? []);
    } catch {
      toast.error("Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [kind, status, debouncedQ, starredOnly]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handler = () => void load();
    window.addEventListener("job-deleted", handler);
    return () => window.removeEventListener("job-deleted", handler);
  }, [load]);

  const stats = useMemo(
    () => ({
      total: jobs.length,
      completed: jobs.filter((j) => j.status === "completed").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    }),
    [jobs],
  );

  return (
    <div className="space-y-6">
      <ViewHeader
        icon={History}
        title="History"
        nativeTitle="इतिहास"
        subtitle="Every translation, transcription and conversion — searchable, re-downloadable, deletable."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                const starredCount = jobs.filter((j) => j.starred).length;
                if (starredCount === 0) {
                  toast.info("No starred jobs to export. Star a job first.");
                  return;
                }
                exportStarredBundle(jobs);
                toast.success(`Exported ${starredCount} starred translation${starredCount === 1 ? "" : "s"} as a bundle.`);
              }}
              disabled={jobs.length === 0}
            >
              <Star className="h-4 w-4" /> Export starred
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (jobs.length === 0) {
                  toast.info("No jobs to export.");
                  return;
                }
                exportJobsAsCsv(jobs);
                toast.success(`Exported ${jobs.length} job${jobs.length === 1 ? "" : "s"} to CSV.`);
              }}
              disabled={jobs.length === 0}
            >
              <Download className="h-4 w-4" /> Export CSV
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard icon={History} label="Total jobs" value={loading ? "—" : stats.total} hint="Matching current filters" />
        <StatCard
          icon={CheckCircle2}
          label="Completed"
          value={loading ? "—" : stats.completed}
          hint="Successful runs"
          accent="primary"
        />
        <StatCard
          icon={XCircle}
          label="Failed"
          value={loading ? "—" : stats.failed}
          hint="Need attention"
          accent="muted"
        />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by text, transcript or filename…"
              className="pl-9"
              aria-label="Search jobs"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="hidden h-4 w-4 text-muted-foreground sm:block" />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger size="sm" className="w-[130px]" aria-label="Filter by kind">
                <SelectValue placeholder="Kind" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All kinds</SelectItem>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="media">Media</SelectItem>
                <SelectItem value="summary">Summary</SelectItem>
                <SelectItem value="convert">Convert</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger size="sm" className="w-[140px]" aria-label="Filter by status">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={starredOnly ? "default" : "outline"}
              size="sm"
              className="gap-1.5"
              onClick={() => setStarredOnly((v) => !v)}
              aria-pressed={starredOnly}
            >
              <Star className={`h-3.5 w-3.5 ${starredOnly ? "fill-current" : ""}`} />
              <span className="hidden sm:inline">Starred</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={History}
          title="No jobs found"
          description="Run a translation, transcription, summary or conversion to see it here. Try clearing your filters."
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <CardContent className="p-0">
              <div className="max-h-[60vh] overflow-y-auto scroll-area-thin">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-card">
                    <TableRow>
                      <TableHead className="w-[80px]">Kind</TableHead>
                      <TableHead className="w-[170px]">Source → Target</TableHead>
                      <TableHead>Input</TableHead>
                      <TableHead className="w-[110px]">Status</TableHead>
                      <TableHead className="w-[150px]">Model</TableHead>
                      <TableHead className="w-[140px]">Created</TableHead>
                      <TableHead className="w-[110px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <HistoryRow key={job.id} job={job} onView={() => setDetailJob(job)} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-3 md:hidden">
            {jobs.map((job) => (
              <HistoryCard key={job.id} job={job} onView={() => setDetailJob(job)} />
            ))}
          </div>
        </>
      )}

      <JobDetailDialog job={detailJob} onClose={() => setDetailJob(null)} />
    </div>
  );
}
