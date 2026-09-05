"use client";

import {
  LayoutDashboard,
  Languages,
  Layers,
  Clapperboard,
  MessagesSquare,
  ScrollText,
  Repeat2,
  BookOpen,
  History,
  Cpu,
  Wand2,
  Settings,
  WifiOff,
  ShieldCheck,
  X,
} from "lucide-react";
import { useAppStore, type ViewId } from "./app-store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";
import { uiText } from "@/lib/ui-language";

interface NavItem {
  id: ViewId;
  label: string;
  native: string;
  icon: typeof LayoutDashboard;
  group: "Tools" | "Workspace";
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", native: "डॅशबोर्ड", icon: LayoutDashboard, group: "Workspace" },
  { id: "text", label: "Text Translate", native: "मजकूर भाषांतर", icon: Languages, group: "Tools" },
  { id: "media", label: "Audio / Video", native: "ध्वनी / व्हिडिओ", icon: Clapperboard, group: "Tools" },
  { id: "chat", label: "Chat with Document", native: "दस्तऐवजाशी संभाषण", icon: MessagesSquare, group: "Tools" },
  { id: "summary", label: "Summary", native: "सारांश", icon: ScrollText, group: "Tools" },
  { id: "convert", label: "Format Convert", native: "स्वरूप बदल", icon: Repeat2, group: "Tools" },
  { id: "glossary", label: "Glossary", native: "शब्दकोश", icon: BookOpen, group: "Tools" },
  { id: "history", label: "History", native: "इतिहास", icon: History, group: "Workspace" },
  { id: "models", label: "Models", native: "प्रारूपे", icon: Cpu, group: "Workspace" },
  { id: "finetune", label: "Fine-tune", native: "फाइन-ट्यून", icon: Wand2, group: "Workspace" },
  { id: "settings", label: "Settings", native: "सेटिंग्ज", icon: Settings, group: "Workspace" },
];

export function SidebarNav() {
  const { activeView, setView, sidebarOpen, setSidebarOpen, uiLanguage } = useAppStore();
  const groups = ["Workspace", "Tools"] as const;

  return (
    <>
      {/* Backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity animate-in fade-in"
          onClick={() => setSidebarOpen(false)}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r bg-sidebar text-sidebar-foreground shadow-2xl transition-transform duration-300 ease-in-out",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        {/* Brand */}
        <div className="flex items-center justify-between gap-2 px-5 py-5 border-b" data-tour="brand">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl shadow-sm overflow-hidden p-0.5">
              <img src="/logo.svg" alt="VaakSetu Logo" className="h-full w-full object-contain" />
            </div>
            <div>
              <p className="text-base font-semibold leading-tight">VaakSetu</p>
              <p className="text-[11px] text-muted-foreground devanagari">वाक्सेतु · BAIF</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto scroll-area-thin px-3 pb-4">
          {groups.map((group) => (
            <div key={group} className="mb-4">
              <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group}
              </p>
              <div className="space-y-0.5">
                {NAV.filter((n) => n.group === group).map((item) => {
                  const active = activeView === item.id;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      data-tour={`nav-${item.id}`}
                      onClick={() => setView(item.id)}
                      className={cn(
                        "group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                          : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <Icon className={cn("h-4 w-4 shrink-0", active ? "" : "text-muted-foreground group-hover:text-sidebar-accent-foreground")} />
                      <span className="flex-1 text-left">{uiText(uiLanguage, item.label)}</span>
                      <span className={cn("text-[10px] devanagari", active ? "text-sidebar-primary-foreground/70" : "text-muted-foreground/70")}>
                        {item.native}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer status */}
        <div className="border-t px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
            <WifiOff className="h-3.5 w-3.5" />
            <span className="font-medium">Offline-ready</span>
            <span className="text-muted-foreground">· on-prem</span>
          </div>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-accent/60 px-3 py-2 text-xs text-accent-foreground">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="font-medium">Open-source only</span>
            <span className="text-muted-foreground">· MIT</span>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">v1.0 · Tech for Good</span>
            <ThemeToggle />
          </div>
        </div>
      </aside>
    </>
  );
}
