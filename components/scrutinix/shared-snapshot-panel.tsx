"use client";

import { useId } from "react";

import { formatTimestamp } from "@/components/shared/scrutinix-types";
import { Button } from "@/components/ui/button";
import type { UnverifiedSnapshot } from "@/lib/domain/shared-snapshot";
import { formatDisplayUrl } from "@/lib/domain/url";

interface SharedSnapshotPanelProps {
  snapshot: UnverifiedSnapshot;
  onScan: () => void;
}

/**
 * A `?shared=` snapshot is whatever the link says, so it never borrows the
 * verdict panel's grammar: no verdict colour, no verdict headline, no score.
 * The claim reads as quoted data under a neutral "Unverified" heading.
 */
export function SharedSnapshotPanel({
  snapshot,
  onScan,
}: SharedSnapshotPanelProps) {
  const headingId = useId();

  return (
    <section className="sx-enter" aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="text-2xl font-semibold tracking-[-0.01em] text-[var(--sx-text)]"
      >
        Unverified snapshot
      </h2>
      <p className="mt-1 font-mono text-sm break-all text-[var(--sx-text-muted)]">
        {formatDisplayUrl(snapshot.url)}
      </p>
      <p className="mt-3 text-sm leading-6 text-[var(--sx-text)]">
        Someone attached a saved result to this link. Scrutinix didn&apos;t
        produce it on this visit, and anyone can edit what a shared link says.
        Scan the URL to get a real result.
      </p>

      <dl className="mt-4 space-y-1.5 font-mono text-xs leading-5">
        <div className="flex gap-3">
          <dt className="w-28 shrink-0 text-[var(--sx-text-soft)] sm:w-40">
            Claimed verdict
          </dt>
          <dd className="min-w-0 text-[var(--sx-text-muted)]">
            {snapshot.verdict}
          </dd>
        </div>
        {snapshot.capturedAt ? (
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-[var(--sx-text-soft)] sm:w-40">
              Claimed scan time
            </dt>
            <dd className="min-w-0 text-[var(--sx-text-muted)]">
              {formatTimestamp(snapshot.capturedAt)}
            </dd>
          </div>
        ) : null}
        {snapshot.summary ? (
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-[var(--sx-text-soft)] sm:w-40">
              Claimed summary
            </dt>
            <dd className="min-w-0 break-words text-[var(--sx-text-muted)]">
              <q>{snapshot.summary}</q>
            </dd>
          </div>
        ) : null}
      </dl>

      <Button
        type="button"
        variant="primary"
        onClick={onScan}
        className="mt-5 h-11 px-4 text-sm"
      >
        Scan this URL
      </Button>
    </section>
  );
}
