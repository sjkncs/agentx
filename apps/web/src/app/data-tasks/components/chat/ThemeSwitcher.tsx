"use client";

import { useT } from "../../../../i18n/locale-context";
import { THEMES, useTheme } from "../../use-theme";

/** Compact theme switcher: light / dark / DeepSeek swatches. */
export function ThemeSwitcher() {
  const t = useT();
  const { theme, setTheme } = useTheme();

  return (
    <div
      data-testid="theme-switcher"
      className="flex items-center gap-1 rounded-full border border-border bg-surface px-1.5 py-1"
      title={t("theme.title")}
    >
      {THEMES.map((th) => (
        <button
          key={th.id}
          type="button"
          aria-label={t(`theme.${th.id}`)}
          title={t(`theme.${th.id}`)}
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
    </div>
  );
}
