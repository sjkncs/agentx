/**
 * apps/marketing/src/data/skill-catalog.ts
 *
 * Static copy of the bundled skill catalog used on the GitHub Pages
 * marketing site. Mirrors apps/web/src/app/(marketing)/skills/page.tsx
 * `FALLBACK_ENTRIES` (the catalog the live page falls back to when
 * the local API is offline) and packages/skills/builtin/skill-catalog.json
 * as of e6f3cf3. Update both when the bundled catalog changes.
 */

export type CatalogEntry = {
  id: string;
  displayName: string;
  description: string;
  category?: string;
  tags?: string[];
  repo: string;
  homepage?: string;
  license?: string;
  icon?: string;
  builtin?: boolean;
};

export const SKILL_CATALOG: ReadonlyArray<CatalogEntry> = [
  {
    id: "slide-kit",
    displayName: "Slide Kit",
    description:
      "Write editable .pptx decks in Python. 17 slide types, 4 themes, real charts, Gemini-powered diagrams.",
    category: "documents",
    repo: "PHY041/claude-skill-slide-kit",
    license: "MIT",
    icon: "🎞️",
  },
  {
    id: "anydesign",
    displayName: "AnyDesign",
    description:
      "Analyzes any image, URL, or Figma file and emits a structured design.md with the full design system.",
    category: "science",
    repo: "uxKero/anydesign",
    license: "MIT",
    icon: "🔬",
  },
  {
    id: "swiftui-design",
    displayName: "SwiftUI Design",
    description:
      "SwiftUI front-end design skill — anti-AI-Slop six rules, design-direction advisor, brand-asset protocol.",
    category: "design",
    repo: "wholiver/swiftui-design-skill",
    license: "MIT",
    icon: "✉️",
  },
  {
    id: "tdd",
    displayName: "Test-Driven Development",
    description:
      "TDD discipline, red-green-refactor, and regression coverage. Source: obra/superpowers.",
    category: "engineering",
    repo: "obra/superpowers",
    license: "MIT",
    icon: "✨",
  },
  {
    id: "brainstorming",
    displayName: "Brainstorming",
    description:
      "Transform rough ideas into fully-formed designs through structured questioning.",
    category: "writing",
    repo: "obra/superpowers",
    license: "MIT",
    icon: "🧠",
  },
  {
    id: "mcp-builder",
    displayName: "MCP Builder",
    description:
      "Guides creation of high-quality MCP servers. Source: anthropics/skills.",
    category: "automation",
    repo: "anthropics/skills",
    license: "Proprietary",
    icon: "�",
  },
  {
    id: "deep-research",
    displayName: "Deep Research",
    description:
      "Execute autonomous multi-step research using Gemini Deep Research Agent.",
    category: "research",
    repo: "sanjay3290/ai-skills",
    license: "MIT",
    icon: "🌙",
  },
  {
    id: "d3js-vis",
    displayName: "D3.js Visualization",
    description:
      "Teaches Claude to produce D3 charts and interactive data visualizations.",
    category: "creative",
    repo: "chrisvoncsefalvay/claude-d3js-skill",
    license: "MIT",
    icon: "📊",
  },
  {
    id: "food-safety",
    displayName: "Food Safety (Heytea)",
    description:
      "Multi-subagent food-safety customer-service skill: intent classification, compliance reply, audit, and work-order generation. Built-in.",
    category: "vertical",
    repo: "sjkncs/data-agent-examples",
    license: "Apache-2.0",
    icon: "🍵",
    builtin: true,
  },
  {
    id: "scroll-world",
    displayName: "Scroll World",
    description:
      "Build immersive scroll-scrubbed 'fly through the world' landing pages — Apple-style continuous 3D camera flight driven by scroll position.",
    category: "creative",
    repo: "oso95/scroll-world",
    license: "MIT",
    icon: "🌐",
  },
  {
    id: "hallmark",
    displayName: "Hallmark (Anti-AI-slop Design)",
    description:
      "Anti-AI-slop design skill: build / audit / redesign / study. Source: Nutlope/hallmark.",
    category: "design",
    repo: "Nutlope/hallmark",
    license: "MIT",
    icon: "✨",
  },
  {
    id: "impeccable",
    displayName: "Impeccable (Design Vocabulary)",
    description:
      "23-command design vocabulary plugin reading PRODUCT.md / DESIGN.md with ~59 deterministic detector rules.",
    category: "design",
    repo: "pbakaus/impeccable",
    license: "MIT",
    icon: "🎨",
  },
  {
    id: "taste-skill",
    displayName: "Taste Skill (Anti-slop Frontend)",
    description:
      "Anti-slop frontend skill with three dials (DESIGN_VARIANCE / MOTION_INTENSITY / VISUAL_DENSITY).",
    category: "design",
    repo: "Leonxlnx/taste-skill",
    license: "MIT",
    icon: "👁️",
  },
];

export const SKILL_CATEGORY_ORDER = [
  "design",
  "creative",
  "documents",
  "engineering",
  "research",
  "automation",
  "writing",
  "vertical",
  "science",
  "other",
] as const;
