import type { Metadata } from "next";
import Link from "next/link";

import {
  PROSE_MEASURE,
  PublicPageShell,
} from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "How Scrutinix checks a link against eight sources and turns what they find into a verdict.",
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
      lead="Eight checks run at the same time and add up to one score. Reputation sources — lists of known bad links — count the most; checks of the link itself keep the result useful when a source is down."
    >
      <section id="scoring" className="scroll-mt-6 space-y-3">
        <SectionHeading>Scoring</SectionHeading>
        <p
          className={`${PROSE_MEASURE} text-sm leading-6 text-[var(--sx-text-muted)]`}
        >
          A Google Safe Browsing match, a threat-feed listing, or several
          VirusTotal engines flagging a link move the verdict most. The
          certificate, the domain&apos;s age, its DNS records, and where the
          link redirects are supporting evidence.
        </p>
        <dl className={`${PROSE_MEASURE} space-y-2 text-sm leading-6`}>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 font-medium text-[var(--sx-text)]">
              Moves the verdict
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              Google Safe Browsing; threat feeds (URLhaus, OpenPhish, ThreatFox,
              Spamhaus DBL, SURBL); VirusTotal; the link pattern model, a small
              model that runs on our server and reads only the link&apos;s text.
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
            <dt className="w-40 shrink-0 font-medium text-[var(--sx-text)]">
              Supporting
            </dt>
            <dd className="text-[var(--sx-text-muted)]">
              The site&apos;s security certificate, domain age and registrar,
              unusual DNS records, redirects.
            </dd>
          </div>
        </dl>
      </section>

      <section className="space-y-3">
        <SectionHeading>Score bands</SectionHeading>
        <p
          className={`${PROSE_MEASURE} text-sm leading-6 text-[var(--sx-text-muted)]`}
        >
          The score runs from 0 to 100. Unknown and Error results show no score:
          the site didn&apos;t respond or the scan failed, so a number would
          claim more than we know. Reputation checks still run on Unknown
          results and are listed with the result.
        </p>
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
        <p
          className={`${PROSE_MEASURE} text-sm leading-6 text-[var(--sx-text-muted)]`}
        >
          Confidence says how much of the picture we saw. A Safe result loses
          confidence when a major reputation source doesn&apos;t answer; a risky
          result gains confidence when separate sources agree. Any check that
          didn&apos;t finish is named next to the verdict.
        </p>
      </section>

      <section className="space-y-3">
        <SectionHeading>Using the scanner</SectionHeading>
        <ul
          className={`${PROSE_MEASURE} space-y-2 text-sm leading-6 text-[var(--sx-text-muted)]`}
        >
          <li>
            Summary shows only the checks that drove the verdict; Full lists all
            eight. Each row expands to its evidence — engines, certificate
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
            A feed listing of this exact link counts as strong evidence; a
            listing of another link on the same site counts for less. Browse
            pages like urlhaus.abuse.ch/browse/ are not matches.
          </li>
        </ul>
      </section>
    </PublicPageShell>
  );
}
