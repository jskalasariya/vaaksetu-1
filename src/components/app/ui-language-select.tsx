"use client";

import { useEffect } from "react";
import { Languages } from "lucide-react";
import { useAppStore } from "./app-store";
import { UI_LANGUAGES } from "@/lib/ui-language";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STORAGE_KEY = "vaaksetu:ui-language";

export function UiLanguageSelect() {
  const { uiLanguage, setUiLanguage } = useAppStore();

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "mr" || stored === "hi") setUiLanguage(stored);
  }, [setUiLanguage]);

  useEffect(() => {
    document.documentElement.lang = uiLanguage;
    window.localStorage.setItem(STORAGE_KEY, uiLanguage);
  }, [uiLanguage]);

  return (
    <div className="flex items-center gap-1.5" title="Interface language">
      <Languages className="hidden h-4 w-4 text-muted-foreground sm:block" />
      <Select value={uiLanguage} onValueChange={(value) => setUiLanguage(value as "en" | "mr" | "hi")}>
        <SelectTrigger size="sm" className="h-9 w-[112px] border-0 bg-transparent px-2 text-xs" aria-label="Interface language">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {UI_LANGUAGES.map((language) => (
            <SelectItem key={language.code} value={language.code}>
              {language.native}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
