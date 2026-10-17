import type { Metadata } from "next";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "Scrutinix Privacy",
  description:
    "What Scrutinix stores locally, what the server processes, and how shared links work.",
};

const sections = [
  {
    title: "What stays local",
    body: "Completed scans are stored in IndexedDB on your device only. Clearing history removes the browser-side archive, with an immediate undo in the same session.",
  },
  {
    title: "What the server does",
    body: "Submitted URLs are processed on the server to query providers, compute the verdict, and stream results back. That processing is necessary for the product to function; nothing about your history is stored server-side.",
  },
  {
    title: "Logging",
    body: "Operational logs keep scan identifiers, timings, cache state, and hashed URL context rather than the original raw URL string.",
  },
  {
    title: "Shared links",
    body: "Share links embed a browser-generated snapshot in the URL itself — there is no server-side share database. Nothing signs that snapshot, so anyone can edit it: an opened link shows it as unverified, and only a fresh scan produces a result. Opening a link sends the snapshot to the web server as part of the page address, like any link, but Scrutinix doesn't scan the target URL or send it to providers unless you choose to scan.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <PublicPageShell
      title="History stays in the browser."
      lead="The server processes submitted URLs to run a live analysis, but saved history and shareable snapshots remain client-side."
    >
      {sections.map((section) => (
        <section key={section.title} className="space-y-2">
          <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
            {section.title}
          </h2>
          <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
            {section.body}
          </p>
        </section>
      ))}
    </PublicPageShell>
  );
}
