"use client";

import {
  Search,
  Keyboard,
  Languages,
  Clapperboard,
  Mic,
  FileText,
  Repeat2,
  History,
  BookOpen,
  Cpu,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppStore, type ViewId } from "./app-store";
import { CommandPalette } from "./command-palette";
import { ShortcutsHelp } from "./shortcuts-help";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { ThemeToggle } from "./theme-toggle";
import { AiModeToggle } from "./ai-mode-toggle";
import { UiLanguageSelect } from "./ui-language-select";
import { DashboardView } from "./views/dashboard-view";
import { TextTranslateView } from "./views/text-translate-view";
import { BatchTranslateView } from "./views/batch-translate-view";
import { MediaTranslateView } from "./views/media-translate-view";
import { AudioTranslateView } from "./views/audio-translate-view";
import { DocumentChatView } from "./views/document-chat-view";
import { SummaryView } from "./views/summary-view";
import { ConvertView } from "./views/convert-view";
import { GlossaryView } from "./views/glossary-view";
import { HistoryView } from "./views/history-view";
import { OnboardingTour } from "./onboarding-tour";
import { ModelsView } from "./views/models-view";
import { FinetuneView } from "./views/finetune-view";
import { SettingsView } from "./views/settings-view";
import { cn } from "@/lib/utils";

const PRIMARY_MODES: { id: ViewId; label: string; native: string; icon: typeof Languages }[] = [
  { id: "text", label: "Text", native: "मजकूर", icon: Languages },
  { id: "media", label: "Video", native: "व्हिडिओ", icon: Clapperboard },
  { id: "audio", label: "Audio", native: "ऑडिओ", icon: Mic },
  { id: "chat", label: "Documents", native: "दस्तऐवज", icon: FileText },
  { id: "convert", label: "Convert", native: "रूपांतर", icon: Repeat2 },
];

export function AppShell() {
  const { activeView, setView, uiLanguage } = useAppStore();
  useKeyboardShortcuts();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-primary/20">
      {/* Main Google Translate Layout Container */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Header Bar (Clean, no hamburger) */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-md lg:px-8">
          {/* Left: Brand */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setView("text")}
              className="flex items-center gap-2.5 text-left transition-opacity hover:opacity-90"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl p-0.5 shadow-sm">
                <img src="/logo.svg" alt="VaakSetu" className="h-full w-full object-contain" />
              </div>
              <div>
                <span className="text-lg font-semibold tracking-tight text-foreground">
                  VaakSetu <span className="font-normal text-muted-foreground">Translate</span>
                </span>
                <span className="ml-1.5 hidden text-xs text-muted-foreground devanagari sm:inline">
                  वाक्सेतु
                </span>
              </div>
            </button>
          </div>

          {/* Right Header Actions */}
          <div className="flex items-center gap-2">
            {/* Active Model Pill */}
            <button
              onClick={() => setView("models")}
              className="hidden items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20 sm:inline-flex"
            >
              <span className="h-2 w-2 rounded-full bg-primary animate-pulse" />
              <span>IndicTrans2 · Whisper</span>
            </button>

            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9 rounded-full text-muted-foreground hover:text-foreground"
              onClick={() => window.dispatchEvent(new CustomEvent("vaak:toggle-palette"))}
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </Button>

            <AiModeToggle />

            <UiLanguageSelect />

            <Button
              variant="ghost"
              size="icon"
              className="hidden h-9 w-9 rounded-full text-muted-foreground hover:text-foreground sm:inline-flex"
              onClick={() => window.dispatchEvent(new CustomEvent("vaak:toggle-shortcuts"))}
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-4 w-4" />
            </Button>

            <ThemeToggle />
          </div>
        </header>

        {/* Center Mode Switcher (Google Translate Pills) */}
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 pb-2">
          <div className="flex items-center justify-start sm:justify-center gap-2 overflow-x-auto scroll-area-thin pb-2">
            {PRIMARY_MODES.map((mode, idx) => {
              const isActive = activeView === mode.id;
              const Icon = mode.icon;
              return (
                <button
                  key={`${mode.id}-${idx}`}
                  onClick={() => setView(mode.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all duration-200 shrink-0",
                    isActive
                      ? "bg-primary text-primary-foreground shadow-sm scale-105"
                      : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{uiLanguage === "mr" ? mode.native : uiLanguage === "hi" ? ({ Text: "पाठ", Video: "वीडियो", Audio: "ऑडियो", Documents: "दस्तावेज़", Convert: "रूपांतरण" } as Record<string, string>)[mode.label] : mode.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Main Translation Canvas (Persistent DOM Mounting so state is NEVER lost on tab switch!) */}
        <main className="flex-1 px-4 py-4 lg:px-8">
          <div className="mx-auto w-full max-w-5xl">
            <div className={activeView === "text" ? "block" : "hidden"}>
              <TextTranslateView />
            </div>
            <div className={activeView === "media" ? "block" : "hidden"}>
              <MediaTranslateView />
            </div>
            <div className={activeView === "audio" ? "block" : "hidden"}>
              <AudioTranslateView />
            </div>
            <div className={activeView === "chat" ? "block" : "hidden"}>
              <DocumentChatView />
            </div>
            <div className={activeView === "convert" ? "block" : "hidden"}>
              <ConvertView />
            </div>
            <div className={activeView === "history" ? "block" : "hidden"}>
              <HistoryView />
            </div>
            <div className={activeView === "glossary" ? "block" : "hidden"}>
              <GlossaryView />
            </div>
            <div className={activeView === "models" ? "block" : "hidden"}>
              <ModelsView />
            </div>
            <div className={activeView === "finetune" ? "block" : "hidden"}>
              <FinetuneView />
            </div>
            <div className={activeView === "settings" ? "block" : "hidden"}>
              <SettingsView />
            </div>
            <div className={activeView === "dashboard" ? "block" : "hidden"}>
              <DashboardView />
            </div>
            <div className={activeView === "summary" ? "block" : "hidden"}>
              <SummaryView />
            </div>
            <div className={activeView === "batch" ? "block" : "hidden"}>
              <BatchTranslateView />
            </div>
          </div>
        </main>

        {/* Bottom Navigation Utilities (History / Saved / Oracle / Settings) */}
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-center gap-4 py-6 text-xs text-muted-foreground px-4">
          <button
            onClick={() => setView("history")}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border px-4 py-2 font-medium shadow-sm transition-colors",
              activeView === "history" ? "bg-primary text-primary-foreground border-primary" : "bg-card/60 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <History className="h-4 w-4" />
            <span>History</span>
          </button>

          <button
            onClick={() => setView("glossary")}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border px-4 py-2 font-medium shadow-sm transition-colors",
              activeView === "glossary" ? "bg-primary text-primary-foreground border-primary" : "bg-card/60 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <BookOpen className="h-4 w-4" />
            <span>Saved / Glossary</span>
          </button>

          <button
            onClick={() => setView("models")}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border px-4 py-2 font-medium shadow-sm transition-colors",
              activeView === "models" ? "bg-primary text-primary-foreground border-primary" : "bg-card/60 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Cpu className="h-4 w-4" />
            <span>Hardware Oracle</span>
          </button>

          <button
            onClick={() => setView("settings")}
            className={cn(
              "flex items-center gap-2 rounded-full border border-border px-4 py-2 font-medium shadow-sm transition-colors",
              activeView === "settings" ? "bg-primary text-primary-foreground border-primary" : "bg-card/60 hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Settings className="h-4 w-4" />
            <span>Settings</span>
          </button>
        </div>

        {/* Subtle Footer */}
        <footer className="border-t bg-background/50 px-4 py-3 backdrop-blur lg:px-8 text-center text-xs text-muted-foreground">
          <CommandPalette />
          <ShortcutsHelp />
          <OnboardingTour />
          <p>
            <span className="font-semibold text-foreground">VaakSetu</span> · Offline Multilingual Suite for BAIF · 100% on-premises open-source AI
          </p>
        </footer>
      </div>
    </div>
  );
}
