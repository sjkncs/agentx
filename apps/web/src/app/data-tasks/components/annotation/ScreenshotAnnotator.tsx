"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import { AnnotationCanvas } from "./AnnotationCanvas";
import { overlayBackdropClass, overlayPanelClass } from "../../ui-tokens";

/**
 * Windows-Snipping-Tool-style capture + annotate: grabs a screen/window/tab frame
 * via getDisplayMedia, then lets the user annotate (pen/shapes/select), copy, and
 * download. Rendered as a modal overlay.
 */
export function ScreenshotAnnotator({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const capture = useCallback(async () => {
    setCapturing(true);
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      // Let the video produce a frame.
      await new Promise((r) => setTimeout(r, 300));
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 960;
      canvas.height = video.videoHeight || 540;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      stream.getTracks().forEach((track) => track.stop());

      const img = new Image();
      img.onload = () => setImage(img);
      img.src = canvas.toDataURL("image/png");
    } catch {
      setError(t("annotate.captureDenied"));
    } finally {
      setCapturing(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      setImage(null);
      setError(null);
      void capture();
    }
  }, [open, capture]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-50 grid place-items-center ${overlayBackdropClass}`}
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`max-h-[90vh] w-full max-w-4xl overflow-y-auto p-4 ${overlayPanelClass}`}>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">{t("annotate.title")}</h2>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => void capture()}
              disabled={capturing}
              className="cursor-pointer rounded-md bg-surface px-2.5 py-1 text-[11px] text-muted hover:bg-surface-subtle disabled:opacity-50"
            >
              {capturing ? t("annotate.capturing") : t("annotate.recapture")}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="cursor-pointer rounded-md bg-surface px-2.5 py-1 text-[11px] text-muted hover:bg-surface-subtle"
            >
              {t("annotate.close")}
            </button>
          </div>
        </div>
        {error ? <p className="mb-2 text-[12px] text-rose-600">{error}</p> : null}
        <AnnotationCanvas image={image} onCropped={setImage} />
      </div>
    </div>
  );
}
