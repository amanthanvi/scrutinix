import { MARK, MARK_HEIGHT, MARK_WIDTH, markCells } from "@/lib/brand-mark";
import {
  signalNames,
  type SignalSignature,
  type Verdict,
} from "@/lib/domain/schemas";
import type { Severity } from "@/lib/domain/signal-severity";
import {
  ownershipSentence,
  shareHeadline,
} from "@/lib/domain/verdict-guidance";

/**
 * Share cards (1200 x 630) in the light theme: the cool white ground, ink,
 * and the eight-cell strip. Colours are the hex equivalents of the
 * `app/globals.css` light tokens (Satori does not read OKLCH or CSS
 * variables). Geist is read from the installed package
 * (`lib/og/fonts.ts`), so no font is fetched at render time.
 */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

const C = {
  bg: "#ffffff",
  ink: "#13161c",
  muted: "#51555d",
  soft: "#6b6f76",
  border: "#e4e6e9",
  track: "#e9ebee",
} as const;

/**
 * The ramp with its shapes, as in `app/scrutinix.css`: flagged solid,
 * caution hatched, found-nothing a thin dash, partial a centred short
 * block (never a length that reads as progress), failed an outline,
 * didn't-apply a dashed outline, running the bare track.
 */
type CellShape =
  "solid" | "hatch" | "dash" | "partial" | "outline" | "dashed" | "empty";

const CELL: Record<Severity, { color: string; shape: CellShape }> = {
  malicious: { color: "#d73431", shape: "solid" },
  suspicious: { color: "#c56900", shape: "hatch" },
  clear: { color: "#808388", shape: "dash" },
  neutral: { color: "#6b7c8f", shape: "partial" },
  error: { color: "#6e7279", shape: "outline" },
  skipped: { color: "#8f9297", shape: "dashed" },
  pending: { color: C.track, shape: "empty" },
};

const BAND: Record<Verdict, { surface: string; edge: string }> = {
  safe: { surface: "#eafbf0", edge: "#c0e5ce" },
  suspicious: { surface: "#fff5e4", edge: "#f6d9b2" },
  malicious: { surface: "#fff0ee", edge: "#facecc" },
  critical: { surface: "#ffeef5", edge: "#f5c9dd" },
  unknown: { surface: "#f0f5fa", edge: "#d7dfe7" },
  error: { surface: "#fbf2f0", edge: "#ebd9d6" },
};

const CELL_NAMES = [
  "VirusTotal",
  "Link pattern",
  "Safe Browsing",
  "Threat feeds",
  "Certificate",
  "Registration",
  "DNS",
  "Redirects",
] as const;

function Mark({ scale }: { scale: number }) {
  return (
    <div
      style={{
        display: "flex",
        position: "relative",
        width: MARK_WIDTH * scale,
        height: MARK_HEIGHT * scale,
      }}
    >
      {markCells(scale).map((cell, index) => (
        <div
          key={index}
          style={{
            position: "absolute",
            left: cell.x,
            top: cell.y,
            width: cell.size,
            height: cell.size,
            borderRadius: MARK.radius * scale,
            background: C.ink,
          }}
        />
      ))}
    </div>
  );
}

function Brand() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        fontSize: 30,
        fontWeight: 600,
        letterSpacing: "-0.02em",
        color: C.ink,
      }}
    >
      <Mark scale={1.5} />
      Scrutinix
    </div>
  );
}

function Strip({
  signature,
  labels,
  ink = false,
}: {
  signature: readonly Severity[];
  labels: boolean;
  /** The idealized brand strip: every cell filled in ink, like the mark. */
  ink?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12, width: "100%" }}>
      {signalNames.map((name, index) => {
        const cell = CELL[signature[index] ?? "pending"];
        const shape: CellShape = ink ? "solid" : cell.shape;
        const color = ink ? C.ink : cell.color;
        const outlined = shape === "outline" || shape === "dashed";
        return (
          <div
            key={name}
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: 14,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                height: 22,
                borderRadius: 4,
                overflow: "hidden",
                background: outlined ? "transparent" : C.track,
                border: outlined
                  ? `3px ${shape === "dashed" ? "dashed" : "solid"} ${color}`
                  : "none",
              }}
            >
              {shape === "solid" ? (
                <div
                  style={{ width: "100%", height: "100%", background: color }}
                />
              ) : shape === "partial" ? (
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    height: "100%",
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <div
                    style={{
                      width: "40%",
                      height: "60%",
                      borderRadius: 2,
                      background: color,
                    }}
                  />
                </div>
              ) : shape === "hatch" ? (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    backgroundImage: `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 5px, transparent 5px, transparent 9px)`,
                  }}
                />
              ) : shape === "dash" ? (
                <div style={{ width: "100%", height: 6, background: color }} />
              ) : null}
            </div>
            {labels ? (
              <div
                style={{
                  display: "flex",
                  fontSize: 18,
                  color: C.soft,
                  whiteSpace: "nowrap",
                }}
              >
                {CELL_NAMES[index]}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function clip(value: string, limit = 48): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * A look-alike states its owner once, in place of the domain line: the
 * shared `ownershipSentence`, with both domains in mono and the owner
 * emphasised, so each domain appears exactly once on the card.
 */
function OwnershipLine({
  domain,
  impersonates,
}: {
  domain: string;
  impersonates: string;
}) {
  const sentence = ownershipSentence(domain, impersonates);
  const ownerAt = sentence.indexOf(domain);
  const brandAt = sentence.lastIndexOf(impersonates);
  const parts = [
    { text: sentence.slice(0, ownerAt), mono: false, owner: false },
    { text: clip(domain, 36), mono: true, owner: true },
    {
      text: sentence.slice(ownerAt + domain.length, brandAt),
      mono: false,
      owner: false,
    },
    { text: clip(impersonates, 36), mono: true, owner: false },
    {
      text: sentence.slice(brandAt + impersonates.length),
      mono: false,
      owner: false,
    },
  ];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        fontSize: 32,
        color: C.muted,
        lineHeight: 1.3,
      }}
    >
      {parts.map((part, index) => (
        <span
          key={index}
          style={{
            display: "flex",
            whiteSpace: "pre",
            ...(part.mono
              ? {
                  fontFamily: "Geist Mono",
                  fontWeight: 500,
                  letterSpacing: "-0.02em",
                  color: C.ink,
                  fontSize: part.owner ? 40 : 32,
                }
              : {}),
          }}
        >
          {part.text}
        </span>
      ))}
    </div>
  );
}

/** The default card: what Scrutinix does, in the product's own voice. */
export function DefaultCard() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        padding: "72px 80px",
        background: C.bg,
        color: C.ink,
        fontFamily: "Geist",
      }}
    >
      <Brand />
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        {/* Explicit lines: Satori's own wrap strands "click." alone and
            justifies a wide gap into the first line. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 84,
            fontWeight: 600,
            lineHeight: 1.04,
            letterSpacing: "-0.035em",
          }}
        >
          <div style={{ display: "flex" }}>Check a link before</div>
          <div style={{ display: "flex" }}>you click.</div>
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 32,
            color: C.muted,
            maxWidth: 880,
          }}
        >
          Eight independent checks tell you whether it&apos;s safe to open, and
          who really owns it.
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
        <Strip signature={Array(8).fill("clear")} labels={false} ink />
        <div style={{ display: "flex", fontSize: 24, color: C.soft }}>
          scrutinix.net
        </div>
      </div>
    </div>
  );
}

/** A shared result: verdict band, the instruction, the owner, the strip. */
export function ResultCard({
  verdict,
  tone,
  imperative,
  domain,
  impersonates,
  signature,
  capturedAt,
}: {
  verdict: Verdict;
  /** `getVerdictGuidance().tone`: a look-alike Safe takes the neutral band. */
  tone: Verdict;
  imperative: string;
  domain: string;
  impersonates: string | null;
  signature: SignalSignature | undefined;
  capturedAt: string;
}) {
  const band = BAND[tone];
  const date = new Date(capturedAt);
  const when = Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        padding: "56px 72px",
        background: C.bg,
        color: C.ink,
        fontFamily: "Geist",
        gap: 36,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Brand />
        <div style={{ display: "flex", fontSize: 22, color: C.soft }}>
          {when ? `Shared result · ${when}` : "Shared result"}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "36px 44px",
          borderRadius: 20,
          background: band.surface,
          border: `2px solid ${band.edge}`,
        }}
      >
        <div
          style={{
            display: "flex",
            fontSize: 104,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.04em",
          }}
        >
          {shareHeadline({ verdict, impersonates }, { short: true })}
        </div>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 500 }}>
          {imperative}
        </div>
      </div>

      {impersonates ? (
        <OwnershipLine domain={domain} impersonates={impersonates} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              display: "flex",
              fontSize: 40,
              fontWeight: 500,
              fontFamily: "Geist Mono",
              letterSpacing: "-0.02em",
            }}
          >
            {clip(domain)}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: C.muted }}>
            The registered domain that owns this link.
          </div>
        </div>
      )}

      {signature ? (
        <div style={{ display: "flex", marginTop: "auto" }}>
          <Strip signature={signature} labels />
        </div>
      ) : null}
    </div>
  );
}
