import type { Metadata } from "next";
import Link from "next/link";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "How Scrutinix scores a URL, and which feeds, lists, and local checks a scan uses.",
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
              Google Safe Browsing, VirusTotal, the on-server ML ensemble, and
              threat feeds: URLhaus, OpenPhish, ThreatFox, Spamhaus DBL, and
              SURBL.
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
        <SectionHeading>Sources</SectionHeading>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          These are the inputs behind the eight signals.{" "}
          <Link
            href="/privacy"
            className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
          >
            Privacy
          </Link>{" "}
          states what each one is sent.
        </p>
        <dl className="max-w-[65ch] space-y-4 text-sm leading-6">
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">VirusTotal</dt>
            <dd className="text-[var(--sx-text-muted)]">
              Multi-engine reputation for the full URL. An unseen URL is
              submitted for analysis.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">
              Google Safe Browsing
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              Phishing, malware, unwanted software, and potentially harmful
              application lists.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">URLhaus</dt>
            <dd className="text-[var(--sx-text-muted)]">
              abuse.ch malware URLs. An exact listed URL is high confidence; a
              hostname-only listing is medium confidence. A browse page such as
              urlhaus.abuse.ch/browse/ is not a match.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">OpenPhish</dt>
            <dd className="text-[var(--sx-text-muted)]">
              Community phishing feed, downloaded and matched on this server. An
              exact listed URL is high confidence; a hostname-only match is
              medium confidence.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">ThreatFox</dt>
            <dd className="text-[var(--sx-text-muted)]">
              abuse.ch indicators, searched by hostname. An exact URL indicator
              is high confidence when the feed reports 75 or higher, and medium
              confidence otherwise. Another URL on the same host is medium
              confidence.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">Spamhaus DBL</dt>
            <dd className="text-[var(--sx-text-muted)]">
              Domain blocklist for the registrable domain. Phishing, malware,
              and botnet listings are high confidence. Spam listings and
              listings of abused legitimate domains are medium confidence.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">SURBL</dt>
            <dd className="text-[var(--sx-text-muted)]">
              Domain blocklist for the registrable domain. Phishing, malware,
              and cracked listings are high confidence. An abused-domain listing
              is medium confidence.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">ML ensemble</dt>
            <dd className="text-[var(--sx-text-muted)]">
              A bundled classifier and lexical checks, both run on this server.
              No hosted model is called.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">RDAP</dt>
            <dd className="text-[var(--sx-text-muted)]">
              Public registration data for the registrable domain, from
              rdap.org.
            </dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium text-[var(--sx-text)]">
              DNS, TLS, and the page fetch
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              This server resolves the name, reads the certificate, and requests
              the page to follow redirects.
            </dd>
          </div>
        </dl>
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
            Saved scans stay on this device unless you export or share them. The{" "}
            <Link
              href="/privacy"
              className="text-[var(--sx-text)] underline decoration-[var(--sx-border)] underline-offset-2 hover:decoration-[var(--sx-text-muted)]"
            >
              privacy
            </Link>{" "}
            page lists every service that receives a URL you submit.
          </li>
        </ul>
      </section>
    </PublicPageShell>
  );
}
