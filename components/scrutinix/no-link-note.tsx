"use client";

import { useEffect, useState } from "react";

import { useAnalyzerRuntime } from "@/components/scrutinix/analyzer-runtime";
import { announce, retract } from "@/components/ui/announcer";

/**
 * Past the page's own load: a polite message queued while a screen reader
 * is still announcing the new page can be dropped.
 */
const ANNOUNCE_AFTER_MS = 500;

/**
 * The share sheet sent something with no link Scrutinix could fill in
 * (`POST /share` redirects to `/?nolink=1`): one quiet line under the form
 * (`note`, `NO_LINK_NOTE` from the page) says so, from the first paint,
 * until the person types or pastes (Single or Batch), scans, or taps
 * Analyze on an empty field (whose own error then says it). Nothing is
 * filled in and nothing scans. Screen readers hear it once, politely,
 * through the page's status region (`announce`), and meet the line itself
 * in reading order, since a screen reader's own reading of the new page
 * can talk over the announcement.
 */
export function NoLinkNote({ note }: { note: string }) {
  const { singleUrl, batchInput, formError, active, live } =
    useAnalyzerRuntime();
  const [settled, setSettled] = useState(false);
  // Once the person moves on, the note has said its piece for good.
  if (!settled && (singleUrl || batchInput || formError || active || live)) {
    setSettled(true);
  }

  useEffect(() => {
    if (settled) {
      retract(note);
      return;
    }
    const timer = window.setTimeout(() => announce(note), ANNOUNCE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [note, settled]);

  if (settled) return null;
  return <p className="text-meta mt-3 text-[var(--sx-text-muted)]">{note}</p>;
}
