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
 * Share cards (1200 x 630) in the light theme: the cool near-white ground,
 * ink, the squared verdict band under its heavy rule, and the eight-cell
 * strip. Colours are the hex equivalents of the `app/globals.css` light
 * tokens (Satori does not read OKLCH or CSS variables). Display text is
 * Newsreader, interface text Geist, both read from disk
 * (`lib/og/fonts.ts`), so no font is fetched at render time.
 */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

const C = {
  bg: "#fafcfe",
  ink: "#13161c",
  muted: "#4f535a",
  soft: "#656970",
  border: "#dcdee1",
  track: "#ebedef",
} as const;

/** The display face: the page's `--font-display`. */
const SERIF = "Newsreader";

/**
 * The ramp with its shapes, as in `app/scrutinix.css`: flagged solid,
 * caution hatched, found-nothing a thin dash, partial a centred short
 * block (never a length that reads as progress), failed an outline,
 * didn't-apply a dashed outline, running the bare track.
 */
type CellShape =
  "solid" | "hatch" | "dash" | "partial" | "outline" | "dashed" | "empty";

const CELL: Record<Severity, { color: string; shape: CellShape }> = {
  malicious: { color: "#d02c2a", shape: "solid" },
  suspicious: { color: "#c76b00", shape: "hatch" },
  clear: { color: "#7e8085", shape: "dash" },
  neutral: { color: "#6b7c8f", shape: "partial" },
  error: { color: "#6e7279", shape: "outline" },
  skipped: { color: "#83868b", shape: "dashed" },
  pending: { color: C.track, shape: "empty" },
};

/** Each tone's band: its surface and heavy top rule. */
const BAND: Record<Verdict, { surface: string; rule: string }> = {
  safe: { surface: "#eafbf0", rule: "#02985f" },
  suspicious: { surface: "#fff5e4", rule: "#ce710c" },
  malicious: { surface: "#ffedeb", rule: "#d02c2a" },
  critical: { surface: "#ffeef5", rule: "#b10b69" },
  unknown: { surface: "#f0f5fa", rule: "#6b7c8f" },
  error: { surface: "#fbf2f0", rule: "#a1655b" },
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
        fontFamily: SERIF,
        fontSize: 36,
        fontWeight: 600,
        letterSpacing: "-0.012em",
        color: C.ink,
      }}
    >
      <Mark scale={1.25} />
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
                borderRadius: 3,
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
                <div
                  style={{
                    display: "flex",
                    width: "100%",
                    justifyContent: "center",
                  }}
                >
                  <div
                    style={{
                      width: "52%",
                      height: 5,
                      borderRadius: 2,
                      background: color,
                    }}
                  />
                </div>
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
        fontFamily: SERIF,
        fontSize: 34,
        color: C.ink,
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
                  fontSize: part.owner ? 36 : 30,
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
            fontFamily: SERIF,
            fontSize: 92,
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.026em",
          }}
        >
          <div style={{ display: "flex" }}>Check a link before</div>
          <div style={{ display: "flex" }}>you click.</div>
        </div>
        <div
          style={{
            display: "flex",
            fontFamily: SERIF,
            fontSize: 34,
            lineHeight: 1.35,
            color: C.muted,
            maxWidth: 900,
          }}
        >
          Eight separate checks tell you whether it&apos;s safe to open, and
          which site it really belongs to.
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

      {/* The band: squared, the one tinted block, under its heavy rule. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 16,
          padding: "36px 44px",
          background: band.surface,
          borderTop: `8px solid ${band.rule}`,
        }}
      >
        <div
          style={{
            display: "flex",
            fontFamily: SERIF,
            fontSize: 104,
            fontWeight: 600,
            lineHeight: 0.95,
            letterSpacing: "-0.03em",
          }}
        >
          {shareHeadline({ verdict, impersonates }, { short: true })}
        </div>
        <div style={{ display: "flex", fontFamily: SERIF, fontSize: 38 }}>
          {imperative}
        </div>
      </div>

      {impersonates ? (
        <OwnershipLine domain={domain} impersonates={impersonates} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* The registered domain in the display serif, as on the page. */}
          <div
            style={{
              display: "flex",
              fontFamily: SERIF,
              fontSize: 48,
              fontWeight: 600,
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            {clip(domain)}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: C.muted }}>
            The site this link belongs to.
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
