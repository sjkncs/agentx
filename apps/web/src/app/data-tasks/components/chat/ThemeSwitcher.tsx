"use client";

import { useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import { THEMES, useTheme } from "../../use-theme";

/**
 * Compact theme switcher.
 *
 * Lets the user pick a built-in theme (light / dark / deepseek / soft) and
 * optionally override the accent color via a native color input.
 */
export function ThemeSwitcher() {
  const t = useT();
  const { theme, setTheme, accent, setAccent, resetAccent } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <div
      data-testid="theme-switcher"
      className="relative flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1"
      title={t("theme.title")}
    >
      {THEMES.map((th) => (
        <button
          key={th.id}
          type="button"
          aria-label={t(`theme.${th.id}`)}
          title={`${t(`theme.${th.id}`)} — ${th.description}`}
          onClick={() => setTheme(th.id)}
          className={[
            "h-4 w-4 cursor-pointer rounded-full border transition-transform",
            theme === th.id
              ? "scale-110 border-foreground ring-2 ring-primary/40"
              : "border-border hover:scale-105",
          ].join(" ")}
          style={{ backgroundColor: th.swatch }}
        />
      ))}
      <button
        type="button"
        aria-label={t("theme.accent")}
        title={t("theme.accent")}
        data-testid="theme-accent-button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full border",
          open ? "border-foreground" : "border-border",
        ].join(" ")}
        style={{ backgroundColor: accent ?? "transparent" }}
      >
        {!accent ? (
          <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-muted-light" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round">
            <path d="M6 1.5v9M1.5 6h9" />
          </svg>
        ) : null}
      </button>
      {open ? (
        <span
          data-testid="theme-accent-popover"
          className="absolute right-0 top-full z-50 mt-1 flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1.5 shadow-md"
          role="dialog"
          aria-label={t("theme.accent")}
        >
          <input
            type="color"
            value={accent ?? "#7c6cf0"}
            onChange={(e) => setAccent(e.target.value)}
            className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent"
            aria-label={t("theme.accent")}
          />
          <button
            type="button"
            onClick={() => {
              resetAccent();
              setOpen(false);
            }}
            className="text-[11px] text-muted-light underline-offset-2 hover:underline"
          >
            {t("theme.resetAccent")}
          </button>
        </span>
      ) : null}
    </div>
  );
}