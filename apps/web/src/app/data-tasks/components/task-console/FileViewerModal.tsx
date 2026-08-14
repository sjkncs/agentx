"use client";

import { useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import { configApi } from "../../../../lib/config-api";
import type { FileAssetRefDto } from "../../../../lib/config-api";
import { detectRenderKind } from "../../file-render";
import { overlayBackdropClass, overlayPanelClass } from "../../ui-tokens";
import { FileRenderer } from "./FileRenderer";

/**
 * Modal viewer for a work file / artifact: loads its content and renders it with
 * the unified FileRenderer (md / csv / json / image / code / text).
 */
export function FileViewerModal({
  file,
  onClose,
}: {
  file: FileAssetRefDto | null;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let revoked: string | null = null;
    let cancelled = false;
    setText(null);
    setObjectUrl(null);
    setError(null);
    (async () => {
      try {
        const { blob } = await configApi.downloadWorkspaceFile(file.id);
        if (cancelled) return;
        const kind = detectRenderKind(file.filename, file.mimeType);
        if (kind === "image") {
          revoked = URL.createObjectURL(blob);
          setObjectUrl(revoked);
        } else {
          setText(await blob.text());
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t("assets.loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [file, t]);

  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [file, onClose]);

  if (!file) return null;

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center ${overlayBackdropClass}`}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`max-h-[85vh] w-full max-w-3xl overflow-hidden ${overlayPanelClass}`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="truncate text-sm font-semibold text-foreground">{file.filename}</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-subtle">
            {t("annotate.close")}
          </button>
        </div>
        <div className="max-h-[70vh] overflow-auto">
          {error ? (
            <p className="p-4 text-xs text-step-error">{error}</p>
          ) : (
            <FileRenderer
              filename={file.filename}
              mimeType={file.mimeType}
              content={text}
              objectUrl={objectUrl}
            />
          )}
        </div>
      </div>
    </div>
  );
}
