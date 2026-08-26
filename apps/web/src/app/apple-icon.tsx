import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// AgentX apple-touch-icon. Generated at build time by Next.js
// ImageResponse so the PNG always matches the brand SVG and never
// goes stale relative to the source of truth at apps/web/public/brand/.
//
// Palette: deep-space gray #16151C, moon-silver #E8EAF0,
// cool-moonlight rim #C8D6FF. Single subject: the hexagonal prism.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#16151C",
          borderRadius: 40,
        }}
      >
        {/* Pointy-top hexagon prism in moon-silver.
            Coordinates mirror apps/web/public/brand/ax-logo.svg
            scaled to a 180x180 frame. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 180 180"
          width="180"
          height="180"
        >
          <defs>
            <linearGradient id="prism" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#F5F6FA" />
              <stop offset="50%" stopColor="#B8BCC8" />
              <stop offset="100%" stopColor="#6E7383" />
            </linearGradient>
          </defs>
          <polygon
            points="90,45 133,70 133,120 90,145 47,120 47,70"
            fill="url(#prism)"
            stroke="#FFFFFF"
            strokeOpacity="0.35"
            strokeWidth="1.5"
          />
          {/* Specular hot-spot, the cheapest "glass" signal */}
          <circle cx="78" cy="58" r="4" fill="#FFFFFF" />
        </svg>
      </div>
    ),
    { ...size }
  );
}