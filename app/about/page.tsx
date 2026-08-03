import type { Metadata } from "next";
import Link from "next/link";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "How Scrutinix evaluates URLs with streamed multi-signal evidence and confidence scoring.",
};

const scoreBands = [
  { range: "0–24", label: "Safe", color: "var(--sx-safe-fg)" },
  { range: "25–54", label: "Suspicious", color: "var(--sx-suspicious-fg)" },
  { range: "55–79", label: "Malicious", color: "var(--sx-malicious-fg)" },
  { range: "80–100", label: "Critical", color: "var(--sx-critical-fg)" },
] as const;

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
      {children}
    </h2>
  );
}

export default function AboutPage() {
  return (
    <PublicPageShell
      title="How a scan becomes a verdict."
      lead="Eight signals resolve independently and stream into one score. High-confidence reputation checks carry the most weight; local context keeps the result useful when a provider is degraded."
    >
      <section className="space-y-3">
        <SectionHeading>Scoring</SectionHeading>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Safe Browsing matches, community feed hits, and multi-engine
          detections move the verdict most. TLS quality, WHOIS age, DNS posture,
          and redirect behavior are supporting evidence rather than the primary
          driver.
        </p>
        <dl className="max-w-[65ch] space-y-2 text-sm leading-6">
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 font-medium text-[var(--sx-text)]">
              Risk-moving
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              Google Safe Browsing, threat feeds (URLhaus, OpenPhish),
              VirusTotal detections, ML ensemble consensus.
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 font-medium text-[var(--sx-text)]">
              Supporting
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              TLS validation, WHOIS age and registrar, DNS anomalies,
              redirect-chain hops.
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <SectionHeading>Score bands</SectionHeading>
        <dl className="max-w-xs">
          {scoreBands.map((band) => (
            <div
              key={band.range}
              className="border-border flex items-center justify-between gap-3 border-b py-2 last:border-b-0"
            >
              <dt className="font-mono text-sm text-[var(--sx-text-muted)] tabular-nums">
                {band.range}
              </dt>
              <dd className="text-sm font-medium" style={{ color: band.color }}>
                {band.label}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-3">
        <SectionHeading>Confidence</SectionHeading>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Confidence is coverage-aware, not just score bands. A safe verdict
          loses confidence when primary reputation sources time out; a risky
          verdict gains confidence when independent categories agree. Partial
          coverage is always stated next to the verdict.
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeading>Using the scanner</SectionHeading>
        <ul className="max-w-[65ch] space-y-2 text-sm leading-6 text-[var(--sx-text-muted)]">
          <li>
            Each signal row expands to its full evidence — engines, certificate
            fields, redirect hops.
          </li>
          <li>
            Batch rows resolve independently; open any finished row in the{" "}
            <Link
              href="/#scan-console"
              className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
            >
              scanner
            </Link>{" "}
            for the full result.
          </li>
          <li>
            Saved scans stay on this device unless you export or share them —
            see{" "}
            <Link
              href="/privacy"
              className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
            >
              privacy
            </Link>{" "}
            for what the server still processes.
          </li>
          <li>
            Feed matches use the exact URL string you paste — not browse pages
            like urlhaus.abuse.ch/browse/.
          </li>
        </ul>
      </section>
    </PublicPageShell>
  );
}
