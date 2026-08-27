/**
 * apps/web/src/components/marketing/FeatureIcon.tsx
 *
 * Replaces emoji-based icons in marketing pages with consistent Lucide
 * React SVG icons. Mappings cover all 6 hero features on the home page
 * and all skill-card icons on /skills.
 */

import {
  Map,
  Wrench,
  Wand2,
  Plug,
  Package,
  Shield,
  Presentation,
  Microscope,
  Mail,
  Sparkles,
  Brain,
  Globe,
  Moon,
  BarChart3,
  Coffee,
  Palette,
  Eye,
  Heart,
  type LucideProps,
} from "lucide-react";

type IconName =
  | "compass"
  | "wrench"
  | "magic"
  | "plug"
  | "package"
  | "shield"
  | "presentation"
  | "microscope"
  | "mail"
  | "sparkles"
  | "brain"
  | "globe"
  | "moon"
  | "barchart"
  | "teacup"
  | "palette"
  | "eye"
  | "heart";

const ICON_MAP: Record<IconName, React.ComponentType<LucideProps>> = {
  compass: Map,
  wrench: Wrench,
  magic: Wand2,
  plug: Plug,
  package: Package,
  shield: Shield,
  presentation: Presentation,
  microscope: Microscope,
  mail: Mail,
  sparkles: Sparkles,
  brain: Brain,
  globe: Globe,
  moon: Moon,
  barchart: BarChart3,
  teacup: Coffee,
  palette: Palette,
  eye: Eye,
  heart: Heart,
};

export type { IconName };

interface FeatureIconProps extends LucideProps {
  name: IconName;
}

export function FeatureIcon({ name, ...props }: FeatureIconProps) {
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon {...props} />;
}

/** Mapping from skill card `icon` field (old emoji) to the canonical icon name.
 *  Used by SkillCard in skills/page.tsx. */
export function skillEmojiToIconName(emoji: string | undefined): IconName {
  switch (emoji) {
    case "🎞️":
    case "📽️":
      return "presentation";
    case "🔬":
      return "microscope";
    case "✉️":
      return "mail";
    case "✨":
      return "sparkles";
    case "🧠":
      return "brain";
    case "🌐":
      return "globe";
    case "🌙":
      return "moon";
    case "📊":
      return "barchart";
    case "🍵":
      return "teacup";
    case "🎨":
      return "palette";
    case "👁️":
      return "eye";
    case "🔧":
      return "wrench";
    case "🛡":
      return "shield";
    case "🔌":
      return "plug";
    default:
      return "sparkles";
  }
}
