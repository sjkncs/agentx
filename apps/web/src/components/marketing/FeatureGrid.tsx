/**
 * apps/web/src/components/marketing/FeatureGrid.tsx
 *
 * Client component wrapper around motion.article. Extracted from
 * (marketing)/page.tsx because the page is a server component and
 * framer-motion's motion.* is client-only.
 */

"use client";

import Link from "next/link";
import { motion } from "framer-motion";

import { FeatureIcon, type IconName } from "./FeatureIcon";
import { STAGGER_ITEM_VARIANTS } from "./AnimateIn";

interface Feature {
  icon: IconName;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}

interface FeatureGridProps {
  features: ReadonlyArray<Feature>;
  cardClass: string;
  iconClass: string;
  titleClass: string;
  bodyClass: string;
  linkClass: string;
}

export function FeatureGrid({
  features,
  cardClass,
  iconClass,
  titleClass,
  bodyClass,
  linkClass,
}: FeatureGridProps) {
  return (
    <>
      {features.map((f) => (
        <motion.article
          key={f.title}
          className={cardClass}
          variants={STAGGER_ITEM_VARIANTS}
        >
          <div className={iconClass}>
            <FeatureIcon name={f.icon} size={22} strokeWidth={1.75} />
          </div>
          <h3 className={titleClass}>{f.title}</h3>
          <p className={bodyClass}>{f.body}</p>
          {f.cta ? (
            <Link href={f.cta.href} className={linkClass}>
              {f.cta.label}
            </Link>
          ) : (
            <Link href="/features" className={linkClass}>
              Learn more →
            </Link>
          )}
        </motion.article>
      ))}
    </>
  );
}