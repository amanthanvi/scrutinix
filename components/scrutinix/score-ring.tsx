import { clsx } from "clsx";

/* ── Geometry ─────────────────────────────────── */
const SIZE = 160;
const CENTER = SIZE / 2;
const STROKE = 7;
const RADIUS = 68;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS; // ≈ 427.26

/* Background ring radii (concentric sonar circles) */
const RING_RADII = [54, 40, 26];

/* Crosshair arm length from center */
const CROSSHAIR = 24;

interface ScoreRingProps {
  /** 0–100 threat score */
  score: number;
  /** CSS color value, e.g. "var(--sx-safe)" */
  color: string;
  /** Show active scanning sweep animation */
  isStreaming?: boolean;
  /** Dormant idle state — faint rings, crosshair, no arc */
  isIdle?: boolean;
  /** Label below score number, e.g. "Minimal risk" */
  bandLabel?: string;
  className?: string;
}

/**
 * SVG circular score gauge with concentric sonar rings,
 * a verdict-colored arc, and an optional sweep line during streaming.
 *
 * Three visual states:
 * - **idle**: faint rings + crosshair, no arc or score
 * - **streaming**: rings pulse + sweep line rotates, count in center
 * - **result**: arc fills to score %, score number in center
 */
export function ScoreRing({
  score,
  color,
  isStreaming = false,
  isIdle = false,
  bandLabel,
  className,
}: ScoreRingProps) {
  const clampedScore = Math.min(100, Math.max(0, score));
  const offset = CIRCUMFERENCE * (1 - clampedScore / 100);
  const ringOpacity = isIdle ? 0.1 : 0.18;

  return (
    <div
      className={clsx("relative inline-flex flex-col items-center", className)}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        aria-hidden="true"
        className="block"
      >
        {/* ── Concentric sonar rings ── */}
        {RING_RADII.map((r) => (
          <circle
            key={r}
            cx={CENTER}
            cy={CENTER}
            r={r}
            fill="none"
            stroke="var(--sx-border-muted)"
            strokeWidth={0.75}
            opacity={ringOpacity}
            className="sx-radar-ring"
          />
        ))}

        {/* ── Idle crosshair ── */}
        {isIdle ? (
          <g stroke="var(--sx-border-muted)" strokeWidth={0.75} opacity={0.25}>
            <line
              x1={CENTER}
              y1={CENTER - CROSSHAIR}
              x2={CENTER}
              y2={CENTER + CROSSHAIR}
            />
            <line
              x1={CENTER - CROSSHAIR}
              y1={CENTER}
              x2={CENTER + CROSSHAIR}
              y2={CENTER}
            />
          </g>
        ) : null}

        {/* ── Streaming sweep line ── */}
        {isStreaming ? (
          <g className="sx-radar-sweep-fast">
            <line
              x1={CENTER}
              y1={CENTER}
              x2={CENTER}
              y2={CENTER - RADIUS - 4}
              stroke={color}
              strokeWidth={1.5}
              opacity={0.55}
              strokeLinecap="round"
            />
            {/* Sweep trail — faint wedge via gradient */}
            <circle
              cx={CENTER}
              cy={CENTER}
              r={RADIUS - 2}
              fill="none"
              stroke={color}
              strokeWidth={RADIUS}
              strokeDasharray={`${CIRCUMFERENCE * 0.08} ${CIRCUMFERENCE * 0.92}`}
              opacity={0.06}
            />
          </g>
        ) : null}

        {/* ── Track ring (subtle background for the arc) ── */}
        {!isIdle ? (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke="var(--sx-border-muted)"
            strokeWidth={STROKE}
            opacity={0.12}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
          />
        ) : null}

        {/* ── Score arc (result state only, on top of track) ── */}
        {!isIdle && !isStreaming ? (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            className="sx-score-arc"
          />
        ) : null}

        {/* ── Center text ── */}
        {!isIdle ? (
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            className="sx-font-hack"
            fill={isStreaming ? "var(--sx-text)" : color}
            fontSize={isStreaming ? 36 : 44}
            fontWeight={600}
          >
            {isStreaming ? score : clampedScore}
          </text>
        ) : null}
      </svg>

      {/* ── Band label below ring ── */}
      {bandLabel && !isIdle ? (
        <p className="mt-2 text-center text-sm text-[var(--sx-text-soft)]">
          {bandLabel}
        </p>
      ) : null}
    </div>
  );
}
