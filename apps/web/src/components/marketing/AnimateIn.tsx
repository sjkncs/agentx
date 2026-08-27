/**
 * apps/web/src/components/marketing/AnimateIn.tsx
 *
 * Scroll-triggered entrance animation wrapper using framer-motion.
 * Uses IntersectionObserver-style whileInView so it works on both
 * server-rendered HTML (no layout shift) and client-side hydration.
 */

"use client";

import { motion, type Transition } from "framer-motion";

type AnimationVariant =
  | "fadeUp"
  | "fadeIn"
  | "fadeLeft"
  | "fadeRight"
  | "scaleUp";

const VARIANTS = {
  fadeUp: {
    initial: { opacity: 0, y: 28 },
    animate: { opacity: 1, y: 0 },
  },
  fadeIn: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
  },
  fadeLeft: {
    initial: { opacity: 0, x: -24 },
    animate: { opacity: 1, x: 0 },
  },
  fadeRight: {
    initial: { opacity: 0, x: 24 },
    animate: { opacity: 1, x: 0 },
  },
  scaleUp: {
    initial: { opacity: 0, scale: 0.95 },
    animate: { opacity: 1, scale: 1 },
  },
};

interface AnimateInProps {
  children: React.ReactNode;
  /** Animation direction / style */
  variant?: AnimationVariant;
  /** Delay in seconds before animation starts */
  delay?: number;
  /** Duration in seconds */
  duration?: number;
  /** CSS class — passes through to wrapper div */
  className?: string;
  /** Additional framer-motion spring/timing config */
  transition?: Transition;
  /** Percentage of element visibility needed to trigger (0-1) */
  viewportAmount?: number;
}

const EASING: [number, number, number, number] = [0.22, 1, 0.36, 1];

export function AnimateIn({
  children,
  variant = "fadeUp",
  delay = 0,
  duration = 0.55,
  className,
  transition,
  viewportAmount = 0.15,
}: AnimateInProps) {
  const { initial, animate } = VARIANTS[variant];

  return (
    <motion.div
      className={className}
      initial={initial}
      whileInView={animate}
      viewport={{ once: true, amount: viewportAmount }}
      transition={{
        duration,
        delay,
        ease: EASING,
        ...(transition ?? {}),
      }}
    >
      {children}
    </motion.div>
  );
}

/** Stagger children: each child animates in with a cascade delay.
 *  Wrap the parent, set `staggerChildren` on the container variant. */
interface StaggerContainerProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  staggerDelay?: number;
}

export function StaggerContainer({
  children,
  className,
  style,
  staggerDelay = 0.08,
}: StaggerContainerProps) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={{
        hidden: {},
        visible: {
          transition: {
            staggerChildren: staggerDelay,
            ease: EASING,
          },
        },
      }}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
    >
      {children}
    </motion.div>
  );
}

export const STAGGER_ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 24 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: EASING },
  },
};
