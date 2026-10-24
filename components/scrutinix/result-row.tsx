"use client";

import { LinkAnatomyCompact } from "@/components/scrutinix/link-anatomy";
import { verdictFg } from "@/components/shared/scrutinix-types";
import {
  useLinkAnatomy,
  type LinkAnatomyState,
} from "@/hooks/use-link-anatomy";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";
import type { Verdict } from "@/lib/domain/types";
import { isLookAlikeSafe, verdictWord } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

/**
 * Shared parts of a history or batch row, so both lists state a result
 * the same way: the verdict word (a look-alike Safe takes the neutral tone, as
 * its band does, never a reassuring green) and the compact link anatomy.
 *
 * Row layout: below `sm` the row wraps to two lines - glyph, verdict, and
 * the trailing item on the first; the link alone on the full-width second
 * line - so a phone never squeezes the owner out. From `sm` up it is one
 * line with a fixed verdict column.
 */
export const ROW_LAYOUT =
  "flex min-h-12 flex-wrap items-center gap-x-3 gap-y-0.5 sm:flex-nowrap sm:gap-x-4";

/** The link's second line on phones, the flexible column from `sm` up. */
export const ROW_LINK =
  "order-last basis-full sm:order-none sm:basis-auto sm:flex-1";

/** The trailing item (time, Open) sits right on the phone's first line. */
export const ROW_TRAILING = "ml-auto shrink-0 sm:ml-0";

/**
 * The anatomy of a row's link (null until the parser loads), and whether
 * that answer is final: a row cannot tell a Safe look-alike from a Safe
 * link until it is.
 */
export function useRowAnatomy(url: string): LinkAnatomyState {
  return useLinkAnatomy(url);
}

export function RowVerdict({
  verdict,
  impersonates,
  anatomyReady = true,
  label,
}: {
  verdict: Verdict | null;
  impersonates: string | null;
  /**
   * False while the link parser loads: a Safe row waits rather than flash
   * a reassuring "Safe" that turns into "Look-alike".
   */
  anatomyReady?: boolean;
  /** Shown instead of a verdict while there is none ("Checking"). */
  label?: string;
}) {
  if (verdict === "safe" && !anatomyReady) {
    return (
      <span className="text-meta w-auto shrink-0 font-semibold text-[var(--sx-text-soft)] sm:w-[5.5rem]">
        <span aria-hidden="true">—</span>
      </span>
    );
  }
  const lookAlike = verdict
    ? isLookAlikeSafe({ verdict, impersonates })
    : false;
  return (
    <span
      className={cn(
        "text-meta w-auto shrink-0 font-semibold sm:w-[5.5rem]",
        !verdict && "font-medium",
      )}
      style={{
        color: !verdict
          ? "var(--sx-text-soft)"
          : verdictFg(lookAlike ? "unknown" : verdict),
      }}
    >
      {verdict ? verdictWord({ verdict, impersonates }) : label}
    </span>
  );
}

export function RowLink({
  url,
  anatomy,
}: {
  url: string;
  anatomy: LinkAnatomy | null;
}) {
  return (
    <LinkAnatomyCompact url={url} anatomy={anatomy} className={ROW_LINK} />
  );
}
