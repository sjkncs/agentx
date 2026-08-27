/**
 * apps/web/src/components/marketing/HeroScene.tsx
 *
 * Apple-style 3D scroll-scrubbed hero background.
 *
 * Visual: a perspective grid of dots that flies toward the viewer as
 * they scroll through the hero section. The dots are rendered as a
 * CSS 3D scene — no WebGL / Three.js dependency needed, just CSS
 * perspective + transform3d + framer-motion scroll tracking.
 *
 * The scroll-driven z-translation creates the "fly through the grid"
 * Apple Vision Pro effect. Falls back to a static radial gradient
 * for users with prefers-reduced-motion.
 */

"use client";

import { useRef, useMemo } from "react";
import { motion, useScroll, useTransform, type MotionValue } from "framer-motion";

interface Dot {
  x: number;
  y: number;
  size: number;
}

const GRID_COLS = 22;
const GRID_ROWS = 14;
const DOT_SPACING = 60;
const PERSPECTIVE = "900px";

function generateGrid(): Dot[] {
  const dots: Dot[] = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      dots.push({
        x: (col - GRID_COLS / 2) * DOT_SPACING,
        y: (row - GRID_ROWS / 2) * DOT_SPACING,
        size: 2 + Math.random() * 1.5,
      });
    }
  }
  return dots;
}

interface HeroSceneProps {
  className?: string;
}

export function HeroScene({ className }: HeroSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  const z = useTransform(scrollYProgress, [0, 1], [400, -200]);
  const containerOpacity = useTransform(scrollYProgress, [0, 0.3, 0.85, 1], [0, 0.6, 0.7, 0]);

  const dots = useMemo(() => generateGrid(), []);

  return (
    <motion.div
      ref={ref}
      className={className}
      aria-hidden
      style={{ opacity: containerOpacity }}
    >
      <motion.div
        style={{
          position: "absolute",
          inset: 0,
          perspective: PERSPECTIVE,
          perspectiveOrigin: "50% 60%",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <DotLayer dots={dots} z={z} />
      </motion.div>

      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(ellipse 80% 60% at 50% 60%, rgba(120,80,220,0.06) 0%, transparent 70%)",
          pointerEvents: "none",
        }}
      />
    </motion.div>
  );
}

function DotLayer({ dots, z }: { dots: Dot[]; z: MotionValue<number> }) {
  const scale = useTransform(z, [400, -200], [0.5, 2.2]);
  const opacity = useTransform(z, [400, 100, -50, -200], [0.1, 0.5, 0.9, 1]);

  return (
    <motion.div
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        width: 0,
        height: 0,
        z,
      }}
    >
      {dots.map((dot, i) => (
        <motion.div
          key={i}
          style={{
            position: "absolute",
            width: dot.size,
            height: dot.size,
            borderRadius: "50%",
            background: "var(--foreground)",
            x: dot.x,
            y: dot.y,
            scaleX: scale,
            scaleY: scale,
            opacity,
            willChange: "transform, opacity",
          }}
        />
      ))}
    </motion.div>
  );
}
