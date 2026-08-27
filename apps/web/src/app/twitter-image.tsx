import { ImageResponse } from "next/og";

export const alt = "AgentX — DeepSeek-native AI coding agent harness";
export const size = { width: 1200, height: 675 };
export const contentType = "image/png";

/**
 * apps/web/src/app/twitter-image.tsx
 *
 * Twitter / X summary_large_image card. Next.js auto-emits
 * <meta name="twitter:image"> at build time.
 *
 * Satori constraints (same as opengraph-image.tsx):
 *   - All <div> with multiple children must be display: flex.
 *   - Text content lives in <div>, NOT <text> (Satori rejects <text>).
 */
export default async function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#16151C",
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(35,35,44,1) 0%, rgba(22,21,28,1) 70%)",
          padding: "60px",
          fontFamily: "system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Prism mark */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 320,
            height: 320,
            marginBottom: 32,
          }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 360 360"
            width="320"
            height="320"
          >
            <defs>
              <linearGradient id="prism2" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#F5F6FA" />
                <stop offset="50%" stopColor="#B8BCC8" />
                <stop offset="100%" stopColor="#6E7383" />
              </linearGradient>
              <linearGradient id="rim2" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#A6ACBC" />
                <stop offset="100%" stopColor="#C8D6FF" />
              </linearGradient>
            </defs>
            <rect x="174" y="16" width="12" height="156" fill="#E8EAF0" opacity="0.55" />
            <path d="M180 180 L192 180 L328 328 L328 344 Z" fill="url(#rim2)" opacity="0.65" />
            <g transform="rotate(8 180 180)">
              <polygon
                points="180,94 251,133 251,227 180,266 109,227 109,133"
                fill="url(#prism2)"
                stroke="#FFFFFF"
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
              <line x1="180" y1="94" x2="180" y2="266" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1.5" />
              <line x1="109" y1="133" x2="251" y2="227" stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5" />
              <line x1="251" y1="133" x2="109" y2="227" stroke="#FFFFFF" strokeOpacity="0.12" strokeWidth="1.5" />
              <circle cx="194" cy="108" r="5" fill="#FFFFFF" opacity="0.95" />
              <circle cx="166" cy="116" r="2.5" fill="#FFFFFF" opacity="0.75" />
            </g>
          </svg>
        </div>

        {/* Wordmark */}
        <div
          style={{
            display: "flex",
            fontSize: 86,
            fontWeight: 800,
            color: "#E8EAF0",
            letterSpacing: "-3px",
            lineHeight: 1,
            marginBottom: 18,
          }}
        >
          AgentX
        </div>

        {/* Tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 28,
            fontWeight: 500,
            color: "#C8D6FF",
            lineHeight: 1.3,
            textAlign: "center",
          }}
        >
          An AI coding agent that knows what you work with.
        </div>

        {/* Sub-tagline */}
        <div
          style={{
            display: "flex",
            fontSize: 20,
            fontWeight: 400,
            color: "#8389A0",
            lineHeight: 1.4,
            marginTop: 14,
          }}
        >
          DeepSeek-native · multi-model · local-first
        </div>
      </div>
    ),
    { ...size }
  );
}