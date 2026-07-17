import type { Metadata } from "next";
import { Scale, Zap, BarChart3, ShieldAlert, Activity } from "lucide-react";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "How Scrutinix evaluates URLs with streamed multi-signal evidence and confidence scoring.",
};

export default function AboutPage() {
  return (
    <PublicPageShell
      eyebrow="Method"
      title="Scrutinix turns link triage into one evidence surface instead of a pile of disconnected lookups."
      lead="A scan combines high-confidence reputation checks with resilient local signals so the output stays useful even when one provider is degraded. Each signal resolves independently, and verdict confidence explains how much clean or risky coverage actually supported the final score."
      proofRows={[
        {
          label: "Evidence model",
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
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.95fr)]">
        <section className="space-y-6">
          <div className="border-border border-b pb-6">
            <p className="text-xs text-[var(--sx-text-muted)]">
              Scoring approach
            </p>
            <h2 className="mt-3 text-2xl font-semibold text-[var(--sx-text)]">
              High-confidence evidence moves the verdict most.
            </h2>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--sx-text-muted)]">
              Safe Browsing matches, community feed hits, and stronger
              multi-engine detections outweigh softer context. DNS posture, TLS
              quality, WHOIS age, and redirect behavior still matter, but they
              are supporting evidence rather than the primary driver.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="sx-edge-malicious border-border bg-card rounded-lg border px-5 py-5">
              <div className="flex items-center gap-2">
                <ShieldAlert
                  className="h-4 w-4 shrink-0 text-[var(--sx-malicious)]"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-medium text-[var(--sx-text-muted)]">
                  Risk-moving signals
                </h3>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--sx-text)]">
                <li>Google Safe Browsing</li>
                <li>
                  Threat feeds: URLhaus and OpenPhish — matches use the exact
                  listed URL string, not directory or hub pages.
                </li>
                <li>VirusTotal multi-engine detections</li>
                <li>Local ensemble consensus</li>
              </ul>
            </div>

            <div className="sx-edge-safe border-border bg-card rounded-lg border px-5 py-5">
              <div className="flex items-center gap-2">
                <Activity
                  className="h-4 w-4 shrink-0 text-[var(--sx-safe)]"
                  aria-hidden="true"
                />
                <h3 className="text-sm font-medium text-[var(--sx-text-muted)]">
                  Resilience signals
                </h3>
              </div>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-[var(--sx-text)]">
                <li>TLS validation and certificate metadata</li>
                <li>WHOIS age, registrar, and country</li>
                <li>DNS anomalies and passive observations</li>
                <li>Redirect-chain hops and terminal reachability</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="space-y-6">
          <div className="border-border bg-card rounded-lg border px-5 py-5">
            <p className="text-xs text-[var(--sx-text-muted)]">
              Confidence behavior
            </p>
            <p className="mt-3 text-xl font-semibold text-[var(--sx-text)]">
              Verdicts are coverage-aware, not just score bands.
            </p>
            <p className="mt-3 text-sm leading-7 text-[var(--sx-text-muted)]">
              Partial provider failures reduce confidence even when the headline
              verdict remains safe. Multiple agreeing risk signals raise
              confidence because the evidence came from different categories.
            </p>
          </div>

          <div className="border-border bg-card rounded-lg border px-5 py-5">
            <p className="text-xs text-[var(--sx-text-muted)]">Score bands</p>
            <div className="mt-4 grid gap-3 text-sm leading-6 text-[var(--sx-text)]">
              <div className="flex items-center justify-between gap-3">
                <span>0-24</span>
                <span className="text-[var(--sx-safe)]">Safe</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>25-54</span>
                <span className="text-[var(--sx-suspicious)]">Suspicious</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>55-79</span>
                <span className="text-[var(--sx-malicious)]">Malicious</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span>80-100</span>
                <span className="text-[var(--sx-critical)]">Critical</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PublicPageShell>
  );
}
