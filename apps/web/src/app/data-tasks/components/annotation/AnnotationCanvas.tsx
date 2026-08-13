"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "../../../../i18n/locale-context";
import {
  boundingBox,
  createHistory,
  pickElement,
  pushElement,
  redo as redoHistory,
  replaceElement,
  translate,
  undo as undoHistory,
  type AnnotationElement,
  type AnnotationHistory,
  type AnnotationTool,
  type Point,
} from "./annotation-tools";

const COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#3b82f6", "#000000"];

let idCounter = 0;
const nextId = () => `ann_${++idCounter}_${Date.now().toString(36)}`;

function drawElement(ctx: CanvasRenderingContext2D, el: AnnotationElement) {
  ctx.strokeStyle = el.color;
  ctx.lineWidth = el.tool === "highlighter" ? el.size * 4 : el.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = el.tool === "highlighter" ? 0.4 : 1;

  if (el.tool === "pen" || el.tool === "highlighter") {
    ctx.beginPath();
    el.points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  } else if (el.tool === "rect" || el.tool === "crop") {
    const bb = boundingBox(el);
    if (el.tool === "crop") ctx.setLineDash([6, 4]);
    ctx.strokeRect(bb.x0, bb.y0, bb.x1 - bb.x0, bb.y1 - bb.y0);
    ctx.setLineDash([]);
  } else if (el.tool === "arrow") {
    ctx.beginPath();
    ctx.moveTo(el.start.x, el.start.y);
    ctx.lineTo(el.end.x, el.end.y);
    ctx.stroke();
    const angle = Math.atan2(el.end.y - el.start.y, el.end.x - el.start.x);
    const head = 10 + el.size * 2;
    ctx.beginPath();
    ctx.moveTo(el.end.x, el.end.y);
    ctx.lineTo(el.end.x - head * Math.cos(angle - Math.PI / 6), el.end.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(el.end.x, el.end.y);
    ctx.lineTo(el.end.x - head * Math.cos(angle + Math.PI / 6), el.end.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Canvas annotator: draw pen/highlighter strokes and rect/arrow shapes, select &
 * drag to move elements, undo/redo/clear, copy to clipboard, download PNG.
 * Renders an optional base image (e.g. a captured screenshot) underneath.
 */
export function AnnotationCanvas({
  image,
  onCropped,
}: {
  image: HTMLImageElement | null;
  onCropped?: (img: HTMLImageElement) => void;
}) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [history, setHistory] = useState<AnnotationHistory>(createHistory);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState(COLORS[0]!);
  const [size, setSize] = useState(3);
  const inProgressRef = useRef<AnnotationElement | null>(null);
  const dragRef = useRef<{ id: string; last: Point } | null>(null);

  const width = image?.naturalWidth || 960;
  const height = image?.naturalHeight || 540;

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    if (image) ctx.drawImage(image, 0, 0, width, height);
    for (const el of history.elements) drawElement(ctx, el);
    if (inProgressRef.current) drawElement(ctx, inProgressRef.current);
  }, [history, image, width, height]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const getPoint = (e: React.PointerEvent): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * width,
      y: ((e.clientY - rect.top) / rect.height) * height,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = getPoint(e);
    if (tool === "select") {
      const hit = pickElement(history, p);
      dragRef.current = hit ? { id: hit.id, last: p } : null;
      return;
    }
    if (tool === "pen" || tool === "highlighter") {
      inProgressRef.current = { id: nextId(), tool, points: [p], color, size };
    } else {
      inProgressRef.current = { id: nextId(), tool, start: p, end: p, color, size };
    }
    redraw();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = getPoint(e);
    if (tool === "select" && dragRef.current) {
      const { id, last } = dragRef.current;
      const el = history.elements.find((x) => x.id === id);
      if (el) {
        setHistory((h) => replaceElement(h, translate(el, p.x - last.x, p.y - last.y)));
      }
      dragRef.current = { id, last: p };
      return;
    }
    const el = inProgressRef.current;
    if (!el) return;
    if ("points" in el) el.points.push(p);
    else el.end = p;
    redraw();
  };

  const performCrop = (el: AnnotationElement) => {
    const bb = boundingBox(el);
    const x = Math.max(0, Math.round(bb.x0));
    const y = Math.max(0, Math.round(bb.y0));
    const w = Math.round(bb.x1 - bb.x0);
    const h = Math.round(bb.y1 - bb.y0);
    if (w < 4 || h < 4) return;
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d");
    if (!ctx) return;
    if (image) ctx.drawImage(image, x, y, w, h, 0, 0, w, h);
    // Bake existing annotations (shifted into crop space) so they survive the crop.
    ctx.save();
    ctx.translate(-x, -y);
    for (const el2 of history.elements) drawElement(ctx, el2);
    ctx.restore();
    const img = new Image();
    img.onload = () => {
      onCropped?.(img);
      setHistory(createHistory());
    };
    img.src = off.toDataURL("image/png");
  };

  const onPointerUp = () => {
    if (tool === "select") {
      dragRef.current = null;
      return;
    }
    const el = inProgressRef.current;
    inProgressRef.current = null;
    if (!el) return;
    if (el.tool === "crop") {
      performCrop(el);
      return;
    }
    setHistory((h) => pushElement(h, el));
  };

  const copyToClipboard = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    } catch {
      // Clipboard API unavailable; ignore.
    }
  };

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "annotation.png";
    a.click();
  };

  const toolBtn = (id: AnnotationTool, label: string) => (
    <button
      type="button"
      onClick={() => setTool(id)}
      className={[
        "cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium",
        tool === id ? "bg-primary text-white" : "bg-surface text-muted hover:bg-surface-subtle",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div data-testid="annotation-canvas" className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {toolBtn("pen", t("annotate.pen"))}
        {toolBtn("highlighter", t("annotate.highlight"))}
        {toolBtn("rect", t("annotate.rect"))}
        {toolBtn("arrow", t("annotate.arrow"))}
        {toolBtn("select", t("annotate.select"))}
        {toolBtn("crop", t("annotate.crop"))}
        <span className="mx-1 h-4 w-px bg-border" />
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => setColor(c)}
            className={[
              "h-5 w-5 cursor-pointer rounded-full border",
              color === c ? "border-foreground ring-2 ring-primary/40" : "border-border",
            ].join(" ")}
            style={{ backgroundColor: c }}
          />
        ))}
        <input
          type="range"
          min={1}
          max={12}
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
          className="ml-1 w-24"
        />
        <span className="mx-1 h-4 w-px bg-border" />
        <button type="button" onClick={() => setHistory((h) => undoHistory(h))} className="cursor-pointer rounded-md bg-surface px-2 py-1 text-[11px] text-muted hover:bg-surface-subtle">
          {t("annotate.undo")}
        </button>
        <button type="button" onClick={() => setHistory((h) => redoHistory(h))} className="cursor-pointer rounded-md bg-surface px-2 py-1 text-[11px] text-muted hover:bg-surface-subtle">
          {t("annotate.redo")}
        </button>
        <button type="button" onClick={() => setHistory(createHistory())} className="cursor-pointer rounded-md bg-surface px-2 py-1 text-[11px] text-muted hover:bg-surface-subtle">
          {t("annotate.clear")}
        </button>
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => void copyToClipboard()} className="cursor-pointer rounded-md bg-primary px-2.5 py-1 text-[11px] font-semibold text-white">
            {t("annotate.copy")}
          </button>
          <button type="button" onClick={download} className="cursor-pointer rounded-md bg-surface px-2.5 py-1 text-[11px] text-muted hover:bg-surface-subtle">
            {t("annotate.download")}
          </button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="w-full cursor-crosshair rounded-lg border border-border bg-surface"
        style={{ touchAction: "none" }}
      />
    </div>
  );
}
