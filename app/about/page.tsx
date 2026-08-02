import type { Metadata } from "next";
import Link from "next/link";
import { Scale, Zap, BarChart3, ShieldAlert, Activity } from "lucide-react";
import type { ReactNode } from "react";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "How Scrutinix evaluates URLs with streamed multi-signal evidence and confidence scoring.",
};

const consoleNotes: ReadonlyArray<{ title: string; body: ReactNode }> = [
  {
    title: "Summary vs full",
    body: "Summary prioritizes the highest-impact lanes; full shows every outcome, including caveats.",
  },
  {
    title: "Batch stays isolated",
    body: (
      <>
        Queue short lists, then open any finished row in single-scan mode from
        the{" "}
        <Link
          href="/#scan-console"
          className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
        >
          scan console
        </Link>
        .
      </>
    ),
  },
  {
    title: "Browser-only history",
    body: (
      <>
        Saved scans stay on-device unless you export or share them. See{" "}
        <Link
          href="/privacy"
          className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
        >
          privacy
        </Link>{" "}
        for what the server still processes.
      </>
    ),
  },
  {
    title: "Feed hits distinguish scope",
    body: "URLhaus and OpenPhish treat an exact listed URL as high-confidence evidence. When the path differs, a listed hostname may still appear as a medium-confidence fallback; browse pages like urlhaus.abuse.ch/browse/ are not matches.",
  },
];

export default function AboutPage() {
  return (
    <PublicPageShell
      eyebrow="Method"
      title="How a scan becomes a verdict."
      lead="A scan combines high-confidence reputation checks with resilient local signals so the output stays useful even when one provider is degraded. Each signal resolves independently, and verdict confidence explains how much clean or risky coverage actually supported the final score."
      proofRows={[
        {
          label: "Scoring model",
          value: "Weighted first",
          body: "Browser-protection lists, threat feeds, and multi-engine detections outweigh softer context like domain age or redirect complexity.",
          icon: Scale,
        },
        {
          label: "Delivery",
          value: "Live stream",
          body: "Single and batch scans emit NDJSON events so the UI can show partial results, coverage caveats, and progress in real time.",
          icon: Zap,
        },
        {
          label: "Confidence",
          value: "Coverage-aware",
          body: "Safe verdicts lose confidence when primary reputation sources time out, while risky verdicts gain confidence when categories agree.",
          icon: BarChart3,
        },
      ]}
    >
      <div className="grid gap-12 xl:grid-cols-[minmax(0,1.1fr)_minmax(17rem,0.85fr)] xl:gap-16">
        <section className="space-y-10">
          <div className="sx-prose-block">
            <p className="sx-label">Scoring approach</p>
            <h2 className="mt-3 max-w-[28ch] text-2xl font-semibold tracking-[-0.02em] text-balance text-[var(--sx-text)] sm:text-[1.75rem]">
              High-confidence evidence moves the verdict most.
            </h2>
            <p className="mt-4 max-w-[62ch] text-sm leading-7 text-[var(--sx-text-muted)] sm:text-[0.95rem]">
              Safe Browsing matches, community feed hits, and stronger
              multi-engine detections outweigh softer context. DNS posture, TLS
              quality, WHOIS age, and redirect behavior still matter, but they
              are supporting evidence rather than the primary driver.
            </p>
          </div>

          <div className="grid gap-px overflow-hidden rounded-md border border-[var(--sx-border)] bg-[var(--sx-border)] md:grid-cols-2">
            <div className="sx-edge-malicious bg-[var(--sx-surface)] px-5 py-5">
              <div className="flex items-center gap-2">
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-[var(--sx-malicious)]"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-medium text-[var(--sx-text)]">
                  Risk-moving signals
                </h3>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm leading-6 text-[var(--sx-text-muted)]">
                <li>Google Safe Browsing</li>
                <li>
                  Threat feeds: URLhaus and OpenPhish — exact listed URLs are
                  high confidence; hostname-only fallbacks are medium
                  confidence.
                </li>
                <li>VirusTotal multi-engine detections</li>
                <li>Local ensemble consensus</li>
              </ul>
            </div>

            <div className="sx-edge-safe bg-[var(--sx-surface)] px-5 py-5">
              <div className="flex items-center gap-2">
                <Activity
                  className="h-4 w-4 shrink-0 text-[var(--sx-safe)]"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-medium text-[var(--sx-text)]">
                  Resilience signals
                </h3>
              </div>
              <ul className="mt-4 space-y-2.5 text-sm leading-6 text-[var(--sx-text-muted)]">
                <li>TLS validation and certificate metadata</li>
                <li>WHOIS age, registrar, and country</li>
                <li>DNS anomalies and passive observations</li>
                <li>Redirect-chain hops and terminal reachability</li>
              </ul>
            </div>
          </div>

          <div className="sx-prose-block">
            <p className="sx-label">Using the console</p>
            <h2 className="mt-3 max-w-[28ch] text-2xl font-semibold tracking-[-0.02em] text-balance text-[var(--sx-text)] sm:text-[1.75rem]">
              How to read lanes, batches, and feeds.
            </h2>
            <dl className="border-border mt-6 divide-y divide-[var(--sx-border)] overflow-hidden rounded-md border">
              {consoleNotes.map(({ title, body }) => (
                <div
                  key={title}
                  className="grid gap-2 bg-[var(--sx-surface)] px-5 py-4 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] sm:gap-6"
                >
                  <dt className="text-sm font-medium text-[var(--sx-text)]">
                    {title}
                  </dt>
                  <dd className="text-sm leading-7 text-[var(--sx-text-muted)]">
                    {body}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <aside className="space-y-6">
          <div className="sx-surface-block border-border rounded-md border px-5 py-5">
            <p className="sx-label">Confidence behavior</p>
            <p className="mt-3 text-lg font-semibold tracking-[-0.015em] text-[var(--sx-text)]">
              Coverage-aware, not just score bands.
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Partial provider failures reduce confidence even when the headline
              verdict remains safe. Multiple agreeing risk signals raise
              confidence because the evidence came from different categories.
            </p>
          </div>

          <div className="sx-surface-block border-border rounded-md border px-5 py-5">
            <p className="sx-label">Score bands</p>
            <dl className="mt-4 space-y-0">
              {[
                { range: "0–24", label: "Safe", color: "var(--sx-safe)" },
                {
                  range: "25–54",
                  label: "Suspicious",
                  color: "var(--sx-suspicious)",
                },
                {
                  range: "55–79",
                  label: "Malicious",
                  color: "var(--sx-malicious)",
                },
                {
                  range: "80–100",
                  label: "Critical",
                  color: "var(--sx-critical)",
                },
              ].map((band) => (
                <div
                  key={band.range}
                  className="border-border flex items-center justify-between gap-3 border-b py-2.5 last:border-b-0"
                >
                  <dt className="sx-font-hack text-sm text-[var(--sx-text-muted)] tabular-nums">
                    {band.range}
                  </dt>
                  <dd
                    className="text-sm font-medium"
                    style={{ color: band.color }}
                  >
                    {band.label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </aside>
      </div>
    </PublicPageShell>
  );
}
