/**
 * apps/web/src/components/marketing/SkillCardMotion.tsx
 *
 * Client wrapper for an individual SkillCard. The skill catalog page
 * is a server component (it fetches the live catalog), but the cards
 * themselves need motion.* which is client-only.
 */

"use client";

import { motion } from "framer-motion";

import { FeatureIcon, skillEmojiToIconName } from "./FeatureIcon";
import { STAGGER_ITEM_VARIANTS } from "./AnimateIn";

interface SkillCardProps {
  id: string;
  displayName: string;
  description: string;
  repo: string;
  license?: string;
  homepage?: string;
  icon?: string;
  builtin?: boolean;
  cardClass: string;
  iconClass: string;
  titleClass: string;
  descClass: string;
  metaClass: string;
}

export function SkillCardMotion({
  id,
  displayName,
  description,
  repo,
  license,
  homepage,
  icon,
  builtin,
  cardClass,
  iconClass,
  titleClass,
  descClass,
  metaClass,
}: SkillCardProps) {
  const href = homepage ?? `https://github.com/${repo}`;
  const iconName = skillEmojiToIconName(icon);

  return (
    <motion.a
      id={id}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cardClass}
      variants={STAGGER_ITEM_VARIANTS}
    >
      <span className={iconClass} aria-hidden>
        <FeatureIcon
          name={iconName}
          size={22}
          strokeWidth={1.75}
          style={{ display: "block" }}
        />
      </span>
      <div className={titleClass}>
        {displayName}
        {builtin ? (
          <span
            style={{
              marginLeft: 6,
              fontSize: 10,
              padding: "2px 6px",
              border: "1px solid var(--border)",
              borderRadius: 999,
              color: "var(--text-tertiary)",
            }}
          >
            BUILT-IN
          </span>
        ) : null}
      </div>
      <p className={descClass}>{description}</p>
      <div className={metaClass}>
        {repo} · {license ?? "?"}
      </div>
    </motion.a>
  );
}