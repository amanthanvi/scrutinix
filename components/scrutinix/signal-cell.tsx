import { MARK, MARK_HEIGHT, MARK_WIDTH, markCells } from "@/lib/brand-mark";
import type { Severity } from "@/lib/domain/signal-severity";
import type { SignalName } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

/**
 * The strip's atoms, server-safe (no hooks, no client directive) so the
 * public pages can draw cells and the mark without a client boundary.
 * `data-severity` selects the fill in `app/scrutinix.css`.
 */

/** Short names printed under each strip cell. */
export const cellNames: Record<SignalName, string> = {
  virusTotal: "VirusTotal",
  mlEnsemble: "Link pattern",
  googleSafeBrowsing: "Safe Browsing",
  threatFeeds: "Threat feeds",
  ssl: "Certificate",
  whois: "Registration",
  dns: "DNS",
  redirectChain: "Redirects",
};

export function SignalCell({
  severity,
  live = false,
  settled = false,
  className,
}: {
  severity: Severity;
  /** Pending cells breathe while their check runs. */
  live?: boolean;
  /** Drawn already settled: no fill transition (history, batch, marks). */
  settled?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      data-severity={severity}
      className={cn(
        "sx-cell",
        live && "sx-cell-live",
        settled && "sx-cell-static",
        className,
      )}
    />
  );
}

/** The brand mark: the strip folded 4 x 2, every cell filled. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${MARK_WIDTH} ${MARK_HEIGHT}`}
      width={MARK_WIDTH}
      height={MARK_HEIGHT}
      className={cn("shrink-0", className)}
      fill="currentColor"
    >
      {markCells().map((cell, index) => (
        <rect
          key={index}
          x={cell.x}
          y={cell.y}
          width={cell.size}
          height={cell.size}
          rx={MARK.radius}
        />
      ))}
    </svg>
  );
}
