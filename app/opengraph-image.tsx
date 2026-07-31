import { ImageResponse } from "next/og";

export const alt = "Scrutinix — Multi-Signal URL Threat Analyzer";
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        height: "100%",
        width: "100%",
        flexDirection: "column",
        justifyContent: "space-between",
        background: "#141519",
        padding: "72px",
        color: "#ececee",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontSize: 28,
          fontWeight: 600,
          letterSpacing: "-0.01em",
        }}
      >
        <div
          style={{
            height: 14,
            width: 14,
            borderRadius: 7,
            background: "#7a9ef8",
          }}
        />
        Scrutinix
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            fontSize: 72,
            lineHeight: 1.05,
            fontWeight: 600,
            maxWidth: "900px",
            letterSpacing: "-0.02em",
            color: "#fafafa",
          }}
        >
          Check a link before you click.
        </div>
        <div style={{ fontSize: 30, maxWidth: "820px", color: "#9a9ca3" }}>
          Eight security signals stream into one verdict. Scans stay on your
          device.
        </div>
      </div>
      <div style={{ fontSize: 22, color: "#9a9ca3" }}>scrutinix.net</div>
    </div>,
    size,
  );
}
