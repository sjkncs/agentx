/**
 * apps/web/src/components/marketing/InkCanvas.tsx
 *
 * Sumi-e (水墨) interactive background for the marketing hero.
 *
 * Features:
 *  - HTML5 Canvas 2D, no WebGL dependency.
 *  - On pointer down/move: ink splatter effect with droplets.
 *  - Static ambient: flowing ink mist, floating particles, ink streaks.
 *  - Each frame repaints with natural fade/spread (~1s lifetime).
 *  - Respects prefers-reduced-motion.
 *
 * Mounted once per page. The component is client-only ("use client").
 */

"use client";

import { useEffect, useRef } from "react";

interface InkCanvasProps {
  className?: string;
  style?: React.CSSProperties;
}

const INK_RGB = "15, 18, 28"; // sumi ink with slight blue undertone
const DROPLET_LIFE = 1100; // ms — full lifetime of one droplet
const MAX_DROPLETS = 450; // hard cap

// Static ink elements
interface StaticInk {
  x: number;
  y: number;
  r: number;
  opacity: number;
  angle: number; // for streaks
  type: "blob" | "streak" | "mist";
}

interface Droplet {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  born: number;
  strength: number;
}

export function InkCanvas({ className, style }: InkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const dropletsRef = useRef<Droplet[]>([]);
  const staticInksRef = useRef<StaticInk[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const reducedMotionRef = useRef(false);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    reducedMotionRef.current =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let width = 0;
    let height = 0;
    let dpr = 1;

    function resize() {
      const parent = canvas!.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.max(1, Math.floor(width * dpr));
      canvas!.height = Math.max(1, Math.floor(height * dpr));
      canvas!.style.width = `${width}px`;
      canvas!.style.height = `${height}px`;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Generate static ink elements based on canvas size
      generateStaticInks(width, height);
    }

    function generateStaticInks(w: number, h: number) {
      const inks: StaticInk[] = [];

      // Background blobs - larger, subtle ink pools
      for (let i = 0; i < 8; i++) {
        inks.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 80 + Math.random() * 120,
          opacity: 0.03 + Math.random() * 0.04,
          angle: Math.random() * Math.PI * 2,
          type: "blob",
        });
      }

      // Ink streaks - brush-like strokes
      for (let i = 0; i < 12; i++) {
        const startX = Math.random() * w;
        const startY = Math.random() * h;
        const angle = -Math.PI / 4 + Math.random() * Math.PI / 2;
        const length = 100 + Math.random() * 200;
        inks.push({
          x: startX,
          y: startY,
          r: length,
          opacity: 0.015 + Math.random() * 0.025,
          angle,
          type: "streak",
        });
      }

      // Mist patches - cloud-like formations
      for (let i = 0; i < 15; i++) {
        inks.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: 150 + Math.random() * 250,
          opacity: 0.02 + Math.random() * 0.03,
          angle: 0,
          type: "mist",
        });
      }

      staticInksRef.current = inks;
    }

    resize();
    window.addEventListener("resize", resize);

    function localXY(e: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      drawingRef.current = true;
      const p = localXY(e);
      lastPointRef.current = p;
      // Burst of ink on click
      spawnDroplets(p.x, p.y, 20, 0.8);
      try {
        canvas!.setPointerCapture(e.pointerId);
      } catch {
        /* some browsers throw if not active */
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (!drawingRef.current) return;
      const p = localXY(e);
      const last = lastPointRef.current ?? p;
      const dx = p.x - last.x;
      const dy = p.y - last.y;
      const dist = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.floor(dist / 10));
      const dynamic = Math.min(1, dist / steps / 24);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const x = last.x + dx * t;
        const y = last.y + dy * t;
        spawnDroplets(x, y, 4, 0.4 + 0.5 * dynamic);
      }
      lastPointRef.current = p;
    }

    function onPointerUp(e: PointerEvent) {
      drawingRef.current = false;
      lastPointRef.current = null;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }

    function spawnDroplets(
      x: number,
      y: number,
      count: number,
      strength: number,
    ) {
      for (let i = 0; i < count; i++) {
        if (dropletsRef.current.length >= MAX_DROPLETS) {
          dropletsRef.current.shift();
        }
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.2 + Math.random() * 0.4;
        dropletsRef.current.push({
          x: x + (Math.random() - 0.5) * 6,
          y: y + (Math.random() - 0.5) * 6,
          r: 12 + Math.random() * 32,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          born: performance.now(),
          strength,
        });
      }
    }

    // Spring points for ambient ink drops
    const springs = [
      { x: 0.2, y: 0.35, phase: 0, freq: 0.0003 },
      { x: 0.75, y: 0.55, phase: 1.2, freq: 0.0004 },
      { x: 0.45, y: 0.25, phase: 2.4, freq: 0.00035 },
      { x: 0.85, y: 0.4, phase: 0.8, freq: 0.00045 },
      { x: 0.15, y: 0.65, phase: 3.6, freq: 0.00038 },
    ];

    // Floating mist particles
    interface MistParticle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }
    const mistParticlesRef: MistParticle[] = [];

    function initMistParticles(w: number, h: number) {
      for (let i = 0; i < 30; i++) {
        mistParticlesRef.push({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.3,
          vy: -0.1 - Math.random() * 0.2,
          size: 40 + Math.random() * 80,
          opacity: 0.02 + Math.random() * 0.03,
        });
      }
    }
    initMistParticles(1920, 1080); // Initial size, will resize

    function drawStaticInks(ctx: CanvasRenderingContext2D, w: number, h: number, time: number) {
      for (const ink of staticInksRef.current) {
        ctx.save();
        ctx.globalAlpha = ink.opacity;

        if (ink.type === "blob") {
          // Subtle breathing animation
          const breathe = 1 + 0.05 * Math.sin(time * 0.0005);
          const grad = ctx.createRadialGradient(
            ink.x, ink.y, 0,
            ink.x, ink.y, ink.r * breathe
          );
          grad.addColorStop(0, `rgba(${INK_RGB}, 0.4)`);
          grad.addColorStop(0.4, `rgba(${INK_RGB}, 0.2)`);
          grad.addColorStop(1, `rgba(${INK_RGB}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(ink.x, ink.y, ink.r * breathe, 0, Math.PI * 2);
          ctx.fill();
        }
        else if (ink.type === "streak") {
          // Brush-like streak with slight animation
          const wobble = Math.sin(time * 0.0002 + ink.angle) * 2;
          ctx.translate(ink.x, ink.y);
          ctx.rotate(ink.angle);

          const grad = ctx.createLinearGradient(-ink.r / 2, 0, ink.r / 2, 0);
          grad.addColorStop(0, `rgba(${INK_RGB}, 0)`);
          grad.addColorStop(0.2, `rgba(${INK_RGB}, 0.6)`);
          grad.addColorStop(0.5, `rgba(${INK_RGB}, 1)`);
          grad.addColorStop(0.8, `rgba(${INK_RGB}, 0.6)`);
          grad.addColorStop(1, `rgba(${INK_RGB}, 0)`);

          ctx.strokeStyle = grad;
          ctx.lineWidth = 3 + Math.random() * 4;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(-ink.r / 2 + wobble, 0);
          ctx.quadraticCurveTo(wobble, Math.sin(time * 0.001) * 3, ink.r / 2 + wobble, 0);
          ctx.stroke();
        }
        else if (ink.type === "mist") {
          // Flowing mist with time-based movement
          const flowX = Math.sin(time * 0.00015 + ink.x * 0.01) * 20;
          const flowY = Math.cos(time * 0.00012 + ink.y * 0.01) * 15;
          const grad = ctx.createRadialGradient(
            ink.x + flowX, ink.y + flowY, 0,
            ink.x + flowX, ink.y + flowY, ink.r
          );
          grad.addColorStop(0, `rgba(${INK_RGB}, 0.3)`);
          grad.addColorStop(0.5, `rgba(${INK_RGB}, 0.15)`);
          grad.addColorStop(1, `rgba(${INK_RGB}, 0)`);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(ink.x + flowX, ink.y + flowY, ink.r, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.restore();
      }
    }

    function drawMistParticles(ctx: CanvasRenderingContext2D, w: number, h: number) {
      for (const p of mistParticlesRef) {
        // Wrap around edges
        if (p.x < -p.size) p.x = w + p.size;
        if (p.x > w + p.size) p.x = -p.size;
        if (p.y < -p.size) p.y = h + p.size;
        if (p.y > h + p.size) p.y = -p.size;

        // Move
        p.x += p.vx;
        p.y += p.vy;

        // Draw mist
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(${INK_RGB}, ${p.opacity})`);
        grad.addColorStop(1, `rgba(${INK_RGB}, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick(now: number) {
      timeRef.current = now;
      ctx!.clearRect(0, 0, width, height);

      // Draw static ink elements (background layer)
      if (!reducedMotionRef.current) {
        drawStaticInks(ctx!, width, height, now);
        drawMistParticles(ctx!, width, height);
      }

      // Draw interactive droplets
      const live: Droplet[] = [];
      for (const d of dropletsRef.current) {
        const age = now - d.born;
        if (age > DROPLET_LIFE) continue;
        d.x += d.vx;
        d.y += d.vy;
        d.vx *= 0.982;
        d.vy *= 0.982;

        const spread = 1 + (age / DROPLET_LIFE) * 0.35;
        const fade = 1 - age / DROPLET_LIFE;
        const r = d.r * spread;
        const grad = ctx!.createRadialGradient(d.x, d.y, 0, d.x, d.y, r);
        grad.addColorStop(0, `rgba(${INK_RGB}, ${0.25 * d.strength * fade})`);
        grad.addColorStop(0.4, `rgba(${INK_RGB}, ${0.12 * d.strength * fade})`);
        grad.addColorStop(1, `rgba(${INK_RGB}, 0)`);
        ctx!.fillStyle = grad;
        ctx!.beginPath();
        ctx!.arc(d.x, d.y, r, 0, Math.PI * 2);
        ctx!.fill();
        live.push(d);
      }
      dropletsRef.current = live;

      // Ambient ink drops from springs
      if (!reducedMotionRef.current && !drawingRef.current) {
        for (const s of springs) {
          const pulse = 0.5 + 0.5 * Math.sin(now * s.freq + s.phase);
          if (pulse > 0.9 && Math.random() < 0.03) {
            spawnDroplets(width * s.x, height * s.y, 2, 0.18 + pulse * 0.12);
          }
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("pointerleave", onPointerUp);

    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerUp);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        touchAction: "none",
        cursor: "crosshair",
        ...style,
      }}
    />
  );
}
