"use client";

import type { SVGProps } from "react";

/**
 * Unified semantic icon system for the data-tasks workbench.
 * All icons share a 16x16 viewBox, stroke-based, currentColor, so they inherit
 * text color and scale with font-size. Keeps the feature system visually coherent.
 */

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    ...rest,
  };
}

/** Monitor / task health. */
export function IconMonitor(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M2 3h12v8H2z" />
      <path d="M5 8l2-2 2 2 2-3" />
      <path d="M6 14h4" />
    </svg>
  );
}

/** Awareness / memory (brain-like). */
export function IconAwareness(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2a4 4 0 0 0-4 4c0 1.5.7 2.6 1.5 3.4.6.6.5 1.6.5 2.6h4c0-1 0-2 .5-2.6C11.3 8.6 12 7.5 12 6a4 4 0 0 0-4-4z" />
      <path d="M6.5 14h3" />
    </svg>
  );
}

/** Scheduled task / clock. */
export function IconSchedule(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 2" />
    </svg>
  );
}

/** Skill / spark. */
export function IconSkill(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14 6.5 9.5 2 8l4.5-1.5z" />
    </svg>
  );
}

/** Connector / plug. */
export function IconConnector(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 2v4M10 2v4" />
      <path d="M4 6h8v3a4 4 0 0 1-8 0z" />
      <path d="M8 13v1" />
    </svg>
  );
}

/** Needs-action / alert. */
export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M8 2l6 11H2z" />
      <path d="M8 6v3M8 11.5v.5" />
    </svg>
  );
}

/** Token / usage gauge. */
export function IconUsage(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 13a5.5 5.5 0 0 1 10 0" />
      <path d="M8 13l2.5-3.5" />
    </svg>
  );
}
