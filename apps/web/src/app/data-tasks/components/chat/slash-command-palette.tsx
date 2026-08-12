"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useT } from "../../../../i18n/locale-context";
import type { WorkspaceConfigStore } from "../../data-task-state";

export type SlashCommandSkill = {
  id: string;
  name?: string;
  description?: string;
};

/** Filter skills by query (id/name/description) — case-insensitive. */
export function filterSlashCommands(query: string, skills: WorkspaceConfigStore["skill"]): SlashCommandSkill[] {
  const q = query.toLowerCase();
  if (!q) return skills.map((s) => ({ id: s.id, name: s.name, description: s.description }));
  return skills.filter((s) => {
    const haystack = [s.id, s.name ?? "", s.description ?? ""].join(" ").toLowerCase();
    return haystack.includes(q);
  }).slice(0, 8);
}

type SlashMenuState = { isOpen: boolean; query: string };

interface SlashCommandPalette {
  menu: ReactNode | null;
  /** Install document capture listeners for navigation while menu is open. */
  installNavigation: () => void;
  uninstallNavigation: () => void;
  setMenuState: (state: SlashMenuState) => void;
}

/** Cursor-style / picker: detects "/<query>" at caret position 0, shows matching skills. */
export function useSlashCommandPalette({
  enabled,
  skills,
}: {
  enabled: boolean;
  skills: WorkspaceConfigStore["skill"];
}): SlashCommandPalette {
  const t = useT();
  const [menuState, setMenuState] = useState<SlashMenuState>({ isOpen: false, query: "" });
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const columnRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => filterSlashCommands(menuState.query, skills), [skills, menuState]);

  // Detect "/" at start of value
  const detectSlashPrefix = useCallback(() => {
    const el = textareaRef.current;
    if (!el || !columnRef.current) return;
    const fullValue = el.value;
    const caretPosition = el.selectionStart ?? 0;
    const beforeCaret = fullValue.slice(0, caretPosition);
    // Simple check: value starts with "/" and no newline/space between "/" and caret
    const match = /^(\/[a-z0-9_-]*)$/iu.test(beforeCaret) ? beforeCaret.match(/^\/([a-z0-9_-]*)/u) : null;
    const query = match ? match[1] ?? "" : "";
    
    if (!match || query.length === 0) {
      setMenuState({ isOpen: false, query: "" });
      return;
    }
    
    setMenuState({ isOpen: true, query });
    if (filtered.length > 0) {
      requestAnimationFrame(() => {
        const first = containerRef.current?.querySelector('[data-slash-item="0"]');
        first?.scrollIntoView({ block: "nearest" });
      });
    }
  }, [filtered]);

  useEffect(() => {
    if (!enabled) return;
    const container = columnRef.current;
    if (!container) return;
    const textarea = container.querySelector<HTMLTextAreaElement>("[data-testid=copilot-chat-textarea]") ?? container.querySelector("textarea");
    if (!textarea) return;
    textareaRef.current = textarea;
    
    const handlers = ["input", "keyup", "click"].map((ev) => () => detectSlashPrefix());
    textarea.addEventListener("input", handlers[0]);
    textarea.addEventListener("keyup", handlers[1]);
    textarea.addEventListener("click", handlers[2]);
    
    return () => {
      textarea.removeEventListener("input", handlers[0]);
      textarea.removeEventListener("keyup", handlers[1]);
      textarea.removeEventListener("click", handlers[2]);
    };
  }, [enabled, detectSlashPrefix]);

  // Document capture for keyboard navigation
  const installNavigation = useCallback(() => {
    if (!enabled) return;
    const onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.target !== textareaRef.current) return;
      const ta = event.target as HTMLTextAreaElement;
      if (!menuState.isOpen) return;
      
      if (event.key === "ArrowDown") {
        event.preventDefault();
        // Navigation handled by parent's keydown
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
      } else if (event.key === "Enter" && !event.shiftKey) {
        // Handled by parent
        event.preventDefault();
      } else if (event.key === "Escape") {
        setMenuState({ isOpen: false, query: "" });
        event.preventDefault();
      }
    };
    document.addEventListener("keydown", onKeyDownCapture, true);
    return () => document.removeEventListener("keydown", onKeyDownCapture, true);
  }, [enabled, menuState.isOpen]);

  const uninstallNavigation = useCallback(() => {
    // No-op, caller manages cleanup
  }, []);

  const setMenuStateWithCleanup = useCallback((state: SlashMenuState) => {
    setMenuState(state);
    if (!state.isOpen) {
      textareaRef.current = null;
      columnRef.current = null;
    }
  }, []);

  return {
    menu:
      menuState.isOpen && enabled ? (
        <div
          ref={containerRef}
          data-testid="slash-command-menu"
          className="absolute bottom-full left-3 mb-2 max-h-64 min-w-[240px] max-w-[calc(100vw-8rem)] overflow-y-auto rounded-xl border border-border bg-surface shadow-[0_8px_28px_-6px_rgba(15,23,42,0.12)] backdrop-blur z-40"
        >
          {filtered.length === 0 ? (
            <div className="p-3 text-xs text-muted-light">{t("slash.empty")}</div>
          ) : (
            filtered.map((item: SlashCommandSkill, index: number) => (
              <button
                key={item.id}
                data-slash-item={index.toString()}
                onClick={() => {}} // delegated by parent
                className={[
                  "mb-1 flex min-w-0 flex-1 items-center justify-between rounded-lg px-3 py-2.5 transition-colors duration-200",
                  index === 0 ? "bg-primary-light/10" : "",
                ].join(" ")}
              >
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-foreground">@{item.id}</span>
                  {(item.description ?? "") ? (
                    <span className="mt-0.5 block text-xs leading-5 text-muted">
                      {item.description}
                    </span>
                  ) : null}
                </div>
                <span className="ml-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 text-[10px] font-medium text-muted">@{item.id}</span>
              </button>
            ))
          )}
          <div className="border-t border-border p-2 text-[10px] text-muted-light">{t("slash.hint")}</div>
        </div>
      ) : null,
    installNavigation,
    uninstallNavigation,
    setMenuState: setMenuStateWithCleanup,
  };
}
