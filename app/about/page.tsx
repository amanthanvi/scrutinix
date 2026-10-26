import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";

import {
  LIST_MEASURE,
  PROSE,
  PROSE_MEASURE,
  PublicPageShell,
  SectionHeading,
} from "@/components/scrutinix/public-page-shell";
import { SignalCell, cellNames } from "@/components/scrutinix/signal-cell";
import { capitalize } from "@/lib/domain/copy";
import {
  CONFIDENCE,
  RULES,
  SCORE_BANDS,
  SCORING_TABLES,
  type ScoringTable,
} from "@/lib/domain/methodology";
import { severityWords } from "@/lib/domain/signal-signature";
import { signalLabels, signalNames } from "@/lib/domain/types";

export const metadata: Metadata = {
  title: "About Scrutinix",
  description:
    "The exact points, thresholds, and rules Scrutinix uses to turn eight checks into a verdict.",
};

const BAND_COLOR = {
  safe: "var(--sx-safe-fg)",
  suspicious: "var(--sx-suspicious-fg)",
  malicious: "var(--sx-malicious-fg)",
  critical: "var(--sx-critical-fg)",
} as const;

// The same words the strip's accessible names and titles use.
const cellLegend = (
  ["malicious", "suspicious", "clear", "neutral", "error", "skipped"] as const
).map((severity) => ({
  severity,
  meaning: capitalize(severityWords[severity]),
}));

const DT = "font-medium text-[var(--sx-text)]";
const DD = "text-[var(--sx-text-muted)]";
const TERMS = `${LIST_MEASURE} text-body grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 wrap-break-word sm:grid-cols-[10rem_minmax(0,1fr)]`;
const BULLETS = `${PROSE_MEASURE} text-body flex list-disc flex-col gap-2.5 pl-5 text-[var(--sx-text-muted)] marker:text-[var(--sx-text-soft)]`;

function ScoringTableView({ table }: { table: ScoringTable }) {
  return (
    <div className="flex flex-col gap-3">
      <table
        id={`points-${table.id}`}
        className={`${LIST_MEASURE} text-body w-full table-fixed border-collapse wrap-break-word`}
      >
        <caption className="text-body pb-3 text-left font-medium text-[var(--sx-text)]">
          {table.caption}
        </caption>
        <thead>
          <tr className="text-meta border-b border-[var(--sx-border)] text-left text-[var(--sx-text-soft)]">
            <th scope="col" className="pb-2 font-normal">
              Finding
            </th>
            <th scope="col" className="w-[38%] pb-2 pl-4 font-normal sm:w-56">
              Points
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--sx-border)] align-baseline"
            >
              <th
                scope="row"
                className="py-2.5 text-left font-normal text-pretty text-[var(--sx-text-muted)]"
              >
                {row.finding}
              </th>
              <td className="py-2.5 pl-4 font-medium text-pretty text-[var(--sx-text)] tabular-nums">
                {row.points}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {table.notes.map((note) => (
        <p key={note} className={`${PROSE} text-meta`}>
          {note}
        </p>
      ))}
    </div>
  );
}

export default function AboutPage() {
  return (
    <PublicPageShell
      title="How a scan becomes a verdict."
      lead="Eight checks run at the same time and add up to one score. Lists of known bad links count the most; checks of the link itself keep the answer useful when a list is down."
    >
      <section id="scoring" className="flex scroll-mt-6 flex-col gap-4">
        <SectionHeading>Scoring</SectionHeading>
        <dl className={TERMS}>
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
          <dt className={DT}>Adding up</dt>
          <dd className={DD}>
            Every finding adds points, listed in full below. The total is kept
            between 0 and 100 and sets the band.
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
        <dl className="max-w-xs border-t border-b border-t-[var(--sx-text)] border-b-[var(--sx-border)]">
          {SCORE_BANDS.map((band) => (
            <div
              key={band.verdict}
              className="flex items-center justify-between gap-3 border-b border-[var(--sx-border)] py-2.5 last:border-b-0"
            >
              <dt className="text-body font-mono text-[var(--sx-text-muted)]">
                {band.min}–{band.max}
              </dt>
              <dd
                className="text-body font-semibold"
                style={{ color: BAND_COLOR[band.verdict] }}
              >
                {band.label}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="points" className="flex scroll-mt-6 flex-col gap-10">
        <div className="flex flex-col gap-4">
          <SectionHeading>Points for each finding</SectionHeading>
          <p className={PROSE}>
            These are the numbers the scanner uses, not a simplified version. A
            check that found nothing adds nothing.
          </p>
        </div>
        {SCORING_TABLES.map((table) => (
          <ScoringTableView key={table.id} table={table} />
        ))}
      </section>

      <section id="rules" className="flex scroll-mt-6 flex-col gap-4">
        <SectionHeading>The rules</SectionHeading>
        <dl className={TERMS}>
          {RULES.map((rule) => (
            <Fragment key={rule.term}>
              <dt className={DT}>{rule.term}</dt>
              <dd className={DD}>{rule.text}</dd>
            </Fragment>
          ))}
        </dl>
      </section>

      <section id="confidence" className="flex scroll-mt-6 flex-col gap-4">
        <SectionHeading>Confidence</SectionHeading>
        <p className={PROSE}>
          Confidence says how much of the picture we saw. It&apos;s a figure
          from 0 to 100% that we show as a word: High from {CONFIDENCE.high}%,
          Moderate from {CONFIDENCE.moderate}%, Low below that.
        </p>
        <ul className={BULLETS}>
          {CONFIDENCE.caps.map((cap) => (
            <li key={cap}>{cap}</li>
          ))}
        </ul>
        <details className="sx-disclosure">
          <summary className="text-body inline-flex min-h-11 items-center gap-2 font-medium text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]">
            <svg
              aria-hidden="true"
              viewBox="0 0 8 8"
              className="sx-chevron size-2 fill-current"
            >
              <path d="M2 0l4 4-4 4z" />
            </svg>
            How the figure adds up
          </summary>
          <table
            className={`${LIST_MEASURE} text-body mt-2 w-full table-fixed border-collapse wrap-break-word`}
          >
            <caption className="sr-only">
              How the confidence figure adds up, before the limits above. The
              major lists are VirusTotal, Google Safe Browsing, and the threat
              feeds.
            </caption>
            <thead>
              <tr className="text-meta border-b border-[var(--sx-border)] text-left text-[var(--sx-text-soft)]">
                <th scope="col" className="pb-2 font-normal">
                  For
                </th>
                <th
                  scope="col"
                  className="w-[38%] pb-2 pl-4 font-normal sm:w-56"
                >
                  Percentage points
                </th>
              </tr>
            </thead>
            <tbody>
              {CONFIDENCE.steps.map((row) => (
                <tr
                  key={row.step}
                  className="border-b border-[var(--sx-border)] align-baseline"
                >
                  <th
                    scope="row"
                    className="py-2.5 text-left font-normal text-pretty text-[var(--sx-text-muted)]"
                  >
                    {row.step}
                  </th>
                  <td className="py-2.5 pl-4 font-medium text-pretty text-[var(--sx-text)] tabular-nums">
                    {row.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={`${PROSE} text-meta mt-3`}>{CONFIDENCE.footnote}</p>
        </details>
        <p className={PROSE}>
          Any check that didn&apos;t finish is named next to the verdict.
        </p>
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
          . Each cell leads to its check&apos;s evidence: in Summary, the
          question that cites it; in Full, its row. Each kind of answer has its
          own shape as well as its colour. A cell that found nothing is a thin
          gray dash, never green: green is kept for a Safe verdict, so a quiet
          check never reads as an endorsement.
        </p>
        <ul
          role="list"
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
                className="sx-cell-tall h-5 w-11 shrink-0"
              />
              <span className="text-[var(--sx-text-muted)]">
                {item.meaning}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading>Which site a link belongs to</SectionHeading>
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
        <SectionHeading>Using the scanner</SectionHeading>
        <ul className={BULLETS}>
          <li>
            Summary answers five plain questions, each naming the checks it
            rests on; Full lists all eight checks. Each Full row expands to its
            evidence: engines, certificate fields, redirect hops.
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

      <section id="name" className="flex scroll-mt-6 flex-col gap-4">
        <SectionHeading>The name</SectionHeading>
        <p className={PROSE}>
          Scrutinix (SCROO-tih-nix), from scrutiny: looking closely before you
          trust something.
        </p>
      </section>
    </PublicPageShell>
  );
}
