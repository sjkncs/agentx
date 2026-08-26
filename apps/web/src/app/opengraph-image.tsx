import { ImageResponse } from "next/og";

export const alt = "AgentX — DeepSeek-native AI coding agent harness";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * apps/web/src/app/opengraph-image.tsx
 *
 * Social share card (Open Graph / LinkedIn / Facebook / WeChat / Slack).
 * Next.js App Router auto-emits <meta property="og:image"> at build time
 * and serves the rendered PNG from /opengraph-image.
 *
 * Layout invariant (Satori constraint):
 *   - Every <div> with multiple children MUST declare display: flex.
 *   - Satori renders text via real CSS (not SVG <text>), so all
 *     wordmark / tagline content lives in <div> wrappers, not <text>.
 *   - The prism mark is a single SVG with only geometry primitives
 *     (rect / polygon / line / circle / path), no text.
 *
 * Composition: 2-column flex row at 1200x630. Left column holds the
 * prism mark wrapped in a fixed-aspect flex container; right column
 * stacks the wordmark + tagline in a flex column.
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          background: "#16151C",
          backgroundImage:
            "radial-gradient(circle at 30% 40%, rgba(35,35,44,1) 0%, rgba(22,21,28,1) 70%)",
          padding: "60px 80px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* ── Left: prism mark ──────────────────────────────────── */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 460,
            height: 460,
            flexShrink: 0,
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 460 460"
            width="460"
            height="460"
          >
            <defs>
              <linearGradient id="prism" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#F5F6FA" />
                <stop offset="50%" stopColor="#B8BCC8" />
                <stop offset="100%" stopColor="#6E7383" />
              </linearGradient>
              <linearGradient id="rim" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#A6ACBC" />
                <stop offset="100%" stopColor="#C8D6FF" />
              </linearGradient>
            </defs>
            {/* Vertical beam entering from above */}
            <rect x="222" y="20" width="16" height="200" fill="#E8EAF0" opacity="0.55" />
            {/* Spectrum trail exiting toward lower-right */}
            <path d="M230 230 L246 230 L420 420 L420 440 Z" fill="url(#rim)" opacity="0.65" />
            {/* Pointy-top hexagon prism, rotated 8 degrees */}
            <g transform="rotate(8 230 230)">
              <polygon
                points="230,120 320,170 320,290 230,340 140,290 140,170"
                fill="url(#prism)"
                stroke="#FFFFFF"
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
              <line x1="230" y1="120" x2="230" y2="340" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1.5" />
              <line x1="140" y1="170" x2="320" y2="290" stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5" />
              <line x1="320" y1="170" x2="140" y2="290" stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5" />
              <circle cx="248" cy="138" r="6" fill="#FFFFFF" opacity="0.95" />
              <circle cx="212" cy="148" r="3" fill="#FFFFFF" opacity="0.75" />
            </g>
          </svg>
        </div>

        {/* ── Right: wordmark + tagline (single flex column) ─────── */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            flex: 1,
            paddingLeft: 40,
          }}
        >
          <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color: "#E8EAF0", letterSpacing: "-3px", lineHeight: 1 }}>
            AgentX
          </div>
          <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: "#C8D6FF", lineHeight: 1.3 }}>
              An AI coding agent that knows
            </div>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 500, color: "#C8D6FF", lineHeight: 1.3 }}>
              what you work with.
            </div>
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 22, fontWeight: 400, color: "#8389A0", lineHeight: 1.4 }}>
            DeepSeek-native · multi-model · local-first · skill marketplace
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}