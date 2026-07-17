import { clsx } from "clsx";

/* ── Geometry ─────────────────────────────────── */
const SIZE = 160;
const CENTER = SIZE / 2;
const STROKE = 8;
const RADIUS = 62;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ScoreRingProps {
  /** 0–100 threat score */
  score: number;
  /** CSS color value, e.g. "var(--sx-safe)" */
  color: string;
  /** Show active scanning indeterminate arc */
  isStreaming?: boolean;
  /** Dormant idle state — track only */
  isIdle?: boolean;
  /** Label below score number, e.g. "Minimal risk" */
  bandLabel?: string;
  className?: string;
}

/**
 * Score readout: clean track + progress arc.
 * Streaming uses an indeterminate dash for coverage progress.
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
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="none"
          stroke="var(--sx-border-muted)"
          strokeWidth={STROKE}
          opacity={isIdle ? 0.35 : 0.45}
          transform={`rotate(-90 ${CENTER} ${CENTER})`}
        />

        {isStreaming ? (
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="none"
            stroke={color}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${CIRCUMFERENCE * 0.22} ${CIRCUMFERENCE * 0.78}`}
            transform={`rotate(-90 ${CENTER} ${CENTER})`}
            className="sx-score-live"
          />
        ) : null}

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

        {!isIdle ? (
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            className="sx-font-hack"
            fill={isStreaming ? "var(--sx-text)" : color}
            fontSize={isStreaming ? 32 : 40}
            fontWeight={600}
          >
            {isStreaming ? score : clampedScore}
          </text>
        ) : (
          <text
            x={CENTER}
            y={CENTER}
            textAnchor="middle"
            dominantBaseline="central"
            className="sx-font-hack"
            fill="var(--sx-text-soft)"
            fontSize={14}
            fontWeight={500}
            letterSpacing="0.04em"
          >
            —
          </text>
        )}
      </svg>

      {bandLabel && !isIdle ? (
        <p className="mt-2 text-center text-sm text-[var(--sx-text-soft)]">
          {bandLabel}
        </p>
      ) : null}
    </div>
  );
}
