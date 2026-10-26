"use client";

import { useEffect, useState } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";

/**
 * Past the page's own load: a polite message queued while a screen reader
 * is still announcing the new page can be dropped.
 */
const ANNOUNCE_AFTER_MS = 500;

/**
 * The share sheet sent something with no link Scrutinix could fill in
 * (`POST /share` redirects to `/?nolink=1`): one quiet line under the form
 * (`note`, `NO_LINK_NOTE` from the page) says so, from the first paint,
 * until the person types, pastes, or scans. Nothing is filled in and
 * nothing scans. Screen readers hear it once, politely, from a status
 * region the server already drew empty; the visible line is hidden from
 * them so it is never read twice.
 */
export function NoLinkNote({ note }: { note: string }) {
  const { singleUrl, active, scan, batch } = useAnalyzerRuntime();
  const [spoken, setSpoken] = useState(false);
  const [settled, setSettled] = useState(false);
  // Once the person moves on, the note has said its piece for good.
  if (
    !settled &&
    (singleUrl !== "" ||
      active !== null ||
      scan.state.isStreaming ||
      batch.state.isStreaming)
  ) {
    setSettled(true);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => setSpoken(true), ANNOUNCE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (settled) return null;
  return (
    <>
      <p
        aria-hidden="true"
        className="text-meta mt-3 text-[var(--sx-text-muted)]"
      >
        {note}
      </p>
      <p role="status" className="sr-only">
        {spoken ? note : ""}
      </p>
    </>
  );
}
