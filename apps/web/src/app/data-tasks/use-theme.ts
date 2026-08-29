"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeId = "light" | "dark" | "deepseek" | "soft";

export const THEMES: Array<{ id: ThemeId; swatch: string; surface: string; description: string }> = [
  { id: "light", swatch: "#0d0d0d", surface: "#ffffff", description: "light" },
  { id: "dark", swatch: "#f5f5f5", surface: "#17181c", description: "dark" },
  { id: "deepseek", swatch: "#7c6cf0", surface: "#14141c", description: "deepseek" },
  // "soft" = a lower-contrast, warmer light theme aimed at reducing eye strain.
  // The actual CSS color tokens are defined in globals.css under `[data-theme="soft"]`.
  { id: "soft", swatch: "#a07a4a", surface: "#f4ecdc", description: "soft (low contrast)" },
];

const THEME_KEY = "agentx-theme";
const ACCENT_KEY = "agentx-accent";

/**
 * Stored custom accent color — independently of the chosen theme.
 * Setting it overrides the theme's default --primary color.
 * Empty string means "no custom override" (use the theme default).
 */
export type AccentState = string | null;

function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "deepseek" || stored === "light" || stored === "soft"
    ? stored
    : "light";
}

function readStoredAccent(): AccentState {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(ACCENT_KEY);
  if (!stored) return null;
  // Basic guard: only accept #rgb or #rrggbb
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(stored)) return stored;
  return null;
}

/** Applies and persists the root theme (data-theme attribute on <html>). */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>("light");
  const [accent, setAccent] = useState<AccentState>(null);

  useEffect(() => {
    setTheme(readStoredTheme());
    setAccent(readStoredAccent());
  }, []);

  // Apply theme + accent to <html>
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (theme === "light") delete root.dataset.theme;
    else root.dataset.theme = theme;

    // Apply / clear accent override
    if (accent) {
      root.style.setProperty("--primary", accent);
      root.style.setProperty("--primary-light", mixLight(accent, 0.35));
      root.style.setProperty("--accent", accent);
    } else {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-light");
      root.style.removeProperty("--accent");
    }

    try {
      window.localStorage.setItem(THEME_KEY, theme);
      if (accent) {
        window.localStorage.setItem(ACCENT_KEY, accent);
      } else {
        window.localStorage.removeItem(ACCENT_KEY);
      }
    } catch {
      // storage unavailable; theme still applies for this session
    }
  }, [theme, accent]);

  const setThemeSafe = useCallback((t: ThemeId) => setTheme(t), []);
  const setAccentSafe = useCallback((a: AccentState) => setAccent(a), []);
  const resetAccent = useCallback(() => setAccent(null), []);
  const resetAll = useCallback(() => {
    setTheme("light");
    setAccent(null);
  }, []);

  return {
    theme,
    setTheme: setThemeSafe,
    accent,
    setAccent: setAccentSafe,
    resetAccent,
    resetAll,
  };
}

/** Mix a hex color with white at the given ratio (0..1). */
function mixLight(hex: string, ratio: number): string {
  const clean = hex.replace("#", "");
  const full = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const blend = (channel: number) => Math.round(channel + (255 - channel) * ratio);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(blend(r))}${toHex(blend(g))}${toHex(blend(b))}`;
}
