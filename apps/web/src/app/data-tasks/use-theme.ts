"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeId = "light" | "dark" | "deepseek";

export const THEMES: Array<{ id: ThemeId; swatch: string }> = [
  { id: "light", swatch: "#ffffff" },
  { id: "dark", swatch: "#17181c" },
  { id: "deepseek", swatch: "#7c6cf0" },
];

const THEME_KEY = "datafoundry-theme";

function readStoredTheme(): ThemeId {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "dark" || stored === "deepseek" || stored === "light" ? stored : "light";
}

/** Applies and persists the root theme (data-theme attribute on <html>). */
export function useTheme() {
  const [theme, setTheme] = useState<ThemeId>("light");

  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch {
      // storage unavailable; theme still applies for this session
    }
  }, [theme]);

  const setThemeSafe = useCallback((t: ThemeId) => setTheme(t), []);
  return { theme, setTheme: setThemeSafe };
}
