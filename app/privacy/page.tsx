import type { Metadata } from "next";
import {
  Database,
  FileText,
  Link2,
  Server,
  Eraser,
  Share2,
} from "lucide-react";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "Scrutinix Privacy",
  description:
    "What Scrutinix stores locally, what the server processes, and how shared links work.",
};

export default function PrivacyPage() {
  return (
    <PublicPageShell
      eyebrow="Privacy"
      title="History stays in the browser."
      lead="The server still has to process submitted URLs to query providers and complete a live analysis, but the application is designed so your saved history and shareable snapshots remain client-side wherever possible."
      proofRows={[
        {
          label: "History",
          value: "IndexedDB only",
          body: "Completed scans are stored locally on your device, and clearing that archive removes the client-side copy unless you use the immediate undo.",
          icon: Database,
        },
        {
          label: "Logs",
          value: "Hash-oriented",
          body: "Operational logs keep scan IDs, timings, cache state, and hashed URL context rather than the original raw URL string.",
          icon: FileText,
        },
        {
          label: "Sharing",
          value: "URL snapshot",
          body: "Share links embed a browser-generated snapshot in the URL itself. They are not persisted to a server-side share database.",
          icon: Link2,
        },
      ]}
    >
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.85fr)] xl:gap-16">
        <section className="space-y-10">
          <div className="sx-prose-block">
            <p className="sx-label">What stays local</p>
            <h2 className="mt-3 max-w-[28ch] text-2xl font-semibold tracking-[-0.02em] text-balance text-[var(--sx-text)] sm:text-[1.75rem]">
              History and shared snapshots are client-managed.
            </h2>
            <p className="mt-4 max-w-[62ch] text-sm leading-7 text-[var(--sx-text-muted)] sm:text-[0.95rem]">
              Completed scans are stored in IndexedDB on your device only.
              Shareable links are generated in the browser by encoding a small
              snapshot into the URL itself, so there is no server-side share
              store to manage or breach.
            </p>
          </div>

          <div className="sx-edge-neutral sx-surface-block rounded-md border border-[var(--sx-border)] px-5 py-5">
            <div className="flex items-center gap-2">
              <Server
                className="h-4 w-4 shrink-0 text-[var(--sx-info)]"
                aria-hidden="true"
              />
              <p className="sx-label">What the server still does</p>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Submitted URLs must still be processed on the server to query
              providers, compute the verdict, and stream the results back to the
              browser. That processing is necessary for the product to function.
            </p>
          </div>
        </section>

        <aside className="sx-surface-block border-border divide-border divide-y overflow-hidden rounded-md border">
          <div className="sx-edge-safe px-5 py-5">
            <div className="flex items-center gap-2">
              <FileText
                className="h-4 w-4 shrink-0 text-[var(--sx-safe)]"
                aria-hidden="true"
              />
              <p className="sx-label">Logging boundary</p>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Operational logs capture scan identifiers, cache behavior, timing,
              and hashed URL context rather than the original raw URL string.
            </p>
          </div>

          <div className="sx-edge-safe px-5 py-5">
            <div className="flex items-center gap-2">
              <Eraser
                className="h-4 w-4 shrink-0 text-[var(--sx-safe)]"
                aria-hidden="true"
              />
              <p className="sx-label">Local clearing</p>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Clearing history removes the browser-side archive. The UI exposes
              an immediate undo so accidental wipes can be reversed in the same
              session.
            </p>
          </div>

          <div className="sx-edge-neutral px-5 py-5">
            <div className="flex items-center gap-2">
              <Share2
                className="h-4 w-4 shrink-0 text-[var(--sx-info)]"
                aria-hidden="true"
              />
              <p className="sx-label">Shared links</p>
            </div>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Shared links are convenient, but they represent a snapshot taken
              in the browser at a point in time. Running a fresh scan verifies
              the target against current provider responses.
            </p>
          </div>
        </aside>
      </div>
    </PublicPageShell>
  );
}
