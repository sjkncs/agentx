"use client";

import { useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  linuxInputMethodHint,
  shouldShowInputHint,
  useLinuxDistro,
} from "../../use-linux-distro";
import { btnGhostClass } from "../../ui-tokens";

/**
 * A dismissable banner shown on first entry for users on UOS / Kylin / Deepin.
 *
 * Surfaces the IME shortcut (Ctrl+Space) and lets the user override the
 * distro detection manually in case UA sniffing misses.
 */
export function LinuxDistroHint() {
  const t = useT();
  const { flavor, shouldHintInputMethod, markHintShown, override } = useLinuxDistro();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!shouldHintInputMethod) return;
    const last = readLastHintTs();
    setOpen(shouldShowInputHint(flavor, last));
  }, [flavor, shouldHintInputMethod]);

  if (!open) return null;

  const dismiss = () => {
    markHintShown();
    setOpen(false);
  };

  return (
    <div
      data-testid="linux-distro-hint"
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-md border border-step-warning/40 bg-step-warning/10 px-3 py-2 text-xs text-step-warning"
    >
      <span className="font-medium">{t("linuxDistro.detected", { flavor })}</span>
      <span className="text-foreground/80">{linuxInputMethodHint(flavor)}</span>
      <span className="ml-auto flex items-center gap-1">
        <select
          aria-label={t("linuxDistro.override")}
          value={flavor}
          onChange={(e) =>
            override(
              e.target.value as "uos" | "kylin" | "deepin" | "other" | "unknown",
            )
          }
          className="h-6 rounded-md border border-border bg-surface px-1.5 text-[11px] text-foreground"
        >
          <option value="unknown">—</option>
          <option value="uos">UOS</option>
          <option value="kylin">Kylin</option>
          <option value="deepin">Deepin</option>
          <option value="other">Other Linux</option>
        </select>
        <button
          type="button"
          onClick={dismiss}
          className={btnGhostClass}
          aria-label={t("linuxDistro.dismiss")}
        >
          {t("linuxDistro.dismiss")}
        </button>
      </span>
    </div>
  );
}

function readLastHintTs(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem("agentx-linux-distro-flag-hint-ts");
    return raw ? parseInt(raw, 10) || 0 : 0;
  } catch {
    return 0;
  }
}