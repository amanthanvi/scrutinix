import type { Metadata } from "next";
import Link from "next/link";

import {
  LIST_MEASURE,
  PROSE,
  PROSE_MEASURE,
  PublicPageShell,
  SectionHeading,
} from "@/components/scrutinix/public-page-shell";
import { SignalCell, cellNames } from "@/components/scrutinix/signal-cell";
import { capitalize } from "@/lib/domain/copy";
import { severityWords } from "@/lib/domain/signal-signature";
import { signalLabels, signalNames } from "@/lib/domain/types";

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

// The same words the strip's accessible names and titles use.
const cellLegend = (
  ["malicious", "suspicious", "clear", "neutral", "error", "skipped"] as const
).map((severity) => ({
  severity,
  meaning: capitalize(severityWords[severity]),
}));

const DT = "font-medium text-[var(--sx-text)]";
const DD = "text-[var(--sx-text-muted)]";

export default function AboutPage() {
  return (
    <PublicPageShell
      title="How a scan becomes a verdict."
      lead="Eight checks run at the same time and add up to one score. Lists of known bad links count the most; checks of the link itself keep the answer useful when a list is down."
    >
      <section id="scoring" className="flex scroll-mt-6 flex-col gap-4">
        <SectionHeading>Scoring</SectionHeading>
        <dl
          className={`${LIST_MEASURE} text-body grid gap-x-6 gap-y-3 sm:grid-cols-[10rem_minmax(0,1fr)]`}
        >
          <dt className={DT}>Moves the verdict</dt>
          <dd className={DD}>
            Google Safe Browsing; threat feeds (URLhaus, OpenPhish, ThreatFox,
            Spamhaus DBL, SURBL); VirusTotal; the link pattern model, a small
            model that runs on our server and reads only the link&apos;s text.
          </dd>
          <dt className={DT}>Supporting</dt>
          <dd className={DD}>
            The site&apos;s security certificate, domain age and registrar,
            unusual DNS records, redirects.
          </dd>
          <dt className={DT}>Feed matches</dt>
          <dd className={DD}>
            A feed listing this exact link counts strongly; a listing of another
            page on the same site counts less.
          </dd>
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Score bands</SectionHeading>
        <p className={PROSE}>
          The score runs from 0 to 100. Unknown and Error results show no score:
          the site didn&apos;t respond or the scan failed, so a number would
          claim more than we know. Reputation checks still run on Unknown
          results and are listed with the result.
        </p>
        <dl className="max-w-xs border-y border-[var(--sx-border)]">
          {scoreBands.map((band) => (
            <div
              key={band.range}
              className="flex items-center justify-between gap-3 border-b border-[var(--sx-border)] py-2.5 last:border-b-0"
            >
              <dt className="font-mono text-sm text-[var(--sx-text-muted)]">
                {band.range}
              </dt>
              <dd
                className="text-sm font-semibold"
                style={{ color: band.color }}
              >
                {band.label}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Reading the eight cells</SectionHeading>
        <p className={PROSE}>
          Every result shows one cell per check, always in the same order:{" "}
          {signalNames
            .map((name) =>
              cellNames[name] === signalLabels[name]
                ? cellNames[name]
                : `${cellNames[name]} (${signalLabels[name]})`,
            )
            .join(", ")}
          . Each cell opens its check&apos;s evidence. Each kind of answer has
          its own shape as well as its colour. A cell that found nothing is a
          thin gray dash, never green: green is kept for a Safe verdict, so a
          quiet check never reads as an endorsement.
        </p>
        <ul
          className={`${PROSE_MEASURE} grid gap-x-6 gap-y-2.5 sm:grid-cols-2`}
        >
          {cellLegend.map((item) => (
            <li
              key={item.severity}
              className="text-body flex items-center gap-3"
            >
              <SignalCell
                severity={item.severity}
                settled
                className="h-3 w-8 shrink-0"
              />
              <span className="text-[var(--sx-text-muted)]">
                {item.meaning}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Who owns the link</SectionHeading>
        <p className={PROSE}>
          The part of a link that decides who controls it is the registered
          domain, the name just before the ending such as .com or .co.uk.
          Everything to its left can be chosen freely by the owner, so
          paypal.com.secure-login.xyz belongs to secure-login.xyz. Scrutinix
          shows the registered domain in bold and says so plainly when the rest
          of the link spells out a different site.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Confidence</SectionHeading>
        <p className={PROSE}>
          Confidence says how much of the picture we saw. A Safe result loses
          confidence when a major reputation source doesn&apos;t answer; a risky
          result gains confidence when separate sources agree. Any check that
          didn&apos;t finish is named next to the verdict.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Using the scanner</SectionHeading>
        <ul
          className={`${PROSE_MEASURE} text-body flex list-disc flex-col gap-2.5 pl-5 text-[var(--sx-text-muted)] marker:text-[var(--sx-text-soft)]`}
        >
          <li>
            Summary shows only the checks that drove the verdict; Full lists all
            eight. Each row expands to its evidence: engines, certificate
            fields, redirect hops.
          </li>
          <li>
            Batch checks up to 10 links at once. Rows resolve independently;
            open any finished row in the{" "}
            <Link href="/#scan-console" className="sx-link">
              scanner
            </Link>{" "}
            for the full result.
          </li>
          <li>
            Saved scans stay on this device unless you export or share them. See{" "}
            <Link href="/privacy" className="sx-link">
              privacy
            </Link>{" "}
            for what the server still processes.
          </li>
        </ul>
      </section>
    </PublicPageShell>
  );
}
