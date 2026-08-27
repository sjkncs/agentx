/**
 * apps/web/src/components/marketing/PricingGrid.tsx
 *
 * Client component wrapper for the pricing tier grid. Server-component
 * pages cannot use framer-motion motion.* directly, so the grid is
 * extracted into this client wrapper.
 */

"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { STAGGER_ITEM_VARIANTS } from "./AnimateIn";

interface Tier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  highlighted?: boolean;
  features: ReadonlyArray<string>;
  ctaLabel: string;
  ctaHref: string;
}

interface PricingGridProps {
  tiers: ReadonlyArray<Tier>;
  cardClass: string;
  buttonPrimaryClass: string;
  buttonSecondaryClass: string;
}

export function PricingGrid({
  tiers,
  cardClass,
  buttonPrimaryClass,
  buttonSecondaryClass,
}: PricingGridProps) {
  return (
    <>
      {tiers.map((tier) => (
        <motion.article
          key={tier.id}
          className={cardClass}
          variants={STAGGER_ITEM_VARIANTS}
          style={{
            borderColor: tier.highlighted ? "var(--foreground)" : "var(--border)",
            borderWidth: tier.highlighted ? 2 : 1,
            padding: 28,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div
            style={{
              fontSize: 12,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--text-tertiary)",
              marginBottom: 6,
            }}
          >
            {tier.name}
            {tier.highlighted ? " · Most popular" : ""}
          </div>
          <h3 style={{ fontSize: 24, margin: "0 0 4px 0", letterSpacing: "-0.01em" }}>
            {tier.name}
          </h3>
          <div style={{ margin: "8px 0 12px 0" }}>
            <span style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>
              {tier.price}
            </span>
            <span style={{ color: "var(--text-tertiary)", marginLeft: 8, fontSize: 14 }}>
              {tier.cadence}
            </span>
          </div>
          <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: "0 0 18px 0", lineHeight: 1.5 }}>
            {tier.tagline}
          </p>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: "0 0 22px 0",
              display: "grid",
              gap: 8,
              flexGrow: 1,
            }}
          >
            {tier.features.map((f) => (
              <li
                key={f}
                style={{
                  display: "flex",
                  gap: 8,
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "var(--text-secondary)",
                }}
              >
                <span aria-hidden style={{ color: "var(--foreground)", fontWeight: 700 }}>✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <Link
            href={tier.ctaHref}
            className={tier.highlighted ? buttonPrimaryClass : buttonSecondaryClass}
          >
            {tier.ctaLabel} →
          </Link>
        </motion.article>
      ))}
    </>
  );
}