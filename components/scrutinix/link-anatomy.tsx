"use client";

import { useState, type ReactNode } from "react";

import { formatAge } from "@/lib/domain/copy";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";
import { redirectDestination } from "@/lib/domain/link-anatomy";
import { YOUNG_DOMAIN_DAYS } from "@/lib/domain/signal-severity";
import type { SignalName, SignalResults } from "@/lib/domain/types";
import { formatDisplayUrl } from "@/lib/domain/url";
import { ownershipSentence } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

/** Longest quiet tail shown before "Show full link". */
const PATH_LIMIT = 48;

/** A registered domain longer than this may wrap or truncate. */
const LONG_DOMAIN = 26;

function shorten(value: string, limit = PATH_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * "This link belongs to secure-login.xyz, not paypal.com." built from the
 * shared `ownershipSentence`, with the two domains set in mono.
 */
function OwnershipSentence({
  registeredDomain,
  impersonates,
}: {
  registeredDomain: string;
  impersonates: string;
}) {
  const sentence = ownershipSentence(registeredDomain, impersonates);
  const ownerAt = sentence.indexOf(registeredDomain);
  const brandAt = sentence.lastIndexOf(impersonates);
  return (
    <>
      {sentence.slice(0, ownerAt)}
      <span className="font-mono">{registeredDomain}</span>
      {sentence.slice(ownerAt + registeredDomain.length, brandAt)}
      <span className="font-mono">{impersonates}</span>
      {sentence.slice(brandAt + impersonates.length)}
    </>
  );
}

/**
 * The link, taken apart: scheme, subdomain, the registered domain (the
 * real owner, emphasised), and the quiet path. A look-alike gets one plain
 * sentence, said once here (the verdict's instruction stays action-only).
 *
 * Findings attach to the part they describe by naming it, set in the same
 * mono directly beneath the link: a certificate problem by `https://`, a
 * young domain by the registered domain, and where the link ends when
 * that is another host. Only facts that matter show (no "valid
 * certificate" next to a Malicious verdict), and a fact whose evidence row
 * is already on screen is not repeated.
 *
 * While a scan streams, the fact slots are fixed so nothing above the
 * strip moves: each reads "Checking…" until its check lands, and empty
 * slots collapse only when the scan ends, in the same frame as the verdict.
 *
 * `anatomy` is null until the Public Suffix List has loaded (a shared link
 * gets it from the server); the mono URL shows meanwhile, never a naive
 * split.
 */
export function LinkAnatomyView({
  url,
  anatomy,
  signals,
  visibleSignals = [],
  streaming = false,
}: {
  url: string;
  anatomy: LinkAnatomy | null;
  signals?: SignalResults | null;
  /** Evidence rows on screen: their facts are not repeated here. */
  visibleSignals?: readonly SignalName[];
  /** The scan is running: hold every fact slot open. */
  streaming?: boolean;
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === url;
  const facts =
    signals && anatomy
      ? getAnatomyFacts(url, anatomy, signals, visibleSignals, streaming)
      : [];
  const truncates = Boolean(anatomy && anatomy.path.length > PATH_LIMIT);

  return (
    <div className="flex flex-col gap-3">
      <p
        id="sx-link-anatomy"
        title={anatomy?.href ?? url}
        className="text-body font-mono break-words text-[var(--sx-text-soft)]"
      >
        {anatomy ? (
          <>
            <span>{anatomy.scheme}://</span>
            {anatomy.userinfo ? (
              // Browsers ignore a login name when choosing the site; show it
              // struck through so the line stays faithful to what was pasted.
              <span className="break-all text-[var(--sx-text-soft)] line-through">
                <span className="sr-only">ignored login name </span>
                {anatomy.userinfo}@
              </span>
            ) : null}
            {anatomy.subdomain ? (
              <span className="break-all text-[var(--sx-text-muted)]">
                {anatomy.subdomain}.
              </span>
            ) : null}
            {/* The owner never splits mid-name unless it cannot fit. */}
            <span
              className={cn(
                "text-lead font-semibold text-[var(--sx-text)]",
                anatomy.registeredDomain.length <= LONG_DOMAIN
                  ? "whitespace-nowrap"
                  : "break-all",
              )}
            >
              {anatomy.registeredDomain}
            </span>
            {anatomy.port ? <span>{anatomy.port}</span> : null}
            {anatomy.path ? (
              <span className="break-all">
                {expanded ? anatomy.path : shorten(anatomy.path)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="break-all text-[var(--sx-text-muted)]">{url}</span>
        )}
      </p>

      {truncates ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="sx-link-anatomy"
          onClick={() => setExpandedFor(expanded ? null : url)}
          className="text-meta sx-link -my-2 inline-flex min-h-11 items-center self-start"
        >
          {expanded ? "Shorten link" : "Show full link"}
        </button>
      ) : null}

      {anatomy?.impersonates ? (
        <p className="text-body font-medium text-[var(--sx-text)]">
          <OwnershipSentence
            registeredDomain={anatomy.registeredDomain}
            impersonates={anatomy.impersonates}
          />
        </p>
      ) : null}

      {facts.length > 0 ? (
        <dl className="text-meta grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-4 gap-y-1">
          {facts.map((fact) => (
            <div key={fact.key} className="contents">
              <dt
                className={cn(
                  "min-w-0 truncate",
                  fact.anchor === "label"
                    ? "text-[var(--sx-text-soft)]"
                    : "font-mono text-[var(--sx-text-muted)]",
                )}
              >
                {fact.term}
              </dt>
              <dd
                className={cn(
                  "min-w-0 break-words",
                  fact.pending
                    ? "text-[var(--sx-text-soft)]"
                    : "text-[var(--sx-text)]",
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

interface AnatomyFact {
  key: string;
  /** The segment the fact describes, as it appears in the link. */
  term: ReactNode;
  /** "segment": the term is a piece of the link; "label": plain words. */
  anchor: "segment" | "label";
  value: ReactNode;
  /** A held slot while the scan runs: not a finding. */
  pending?: boolean;
}

const CHECKING = "Checking…";
/** A slot whose check landed with nothing to say, held until the scan ends. */
const NOTHING = <span aria-hidden="true">—</span>;

/** The plain facts attached to the anatomy, as their checks resolve. */
function getAnatomyFacts(
  url: string,
  anatomy: LinkAnatomy,
  signals: SignalResults,
  visibleSignals: readonly SignalName[],
  streaming: boolean,
): AnatomyFact[] {
  const facts: AnatomyFact[] = [];
  // While streaming, Summary's rows change as checks land: ignore them so
  // the slots stay fixed; the dedupe applies once the result is settled.
  const shown = (name: SignalName) =>
    !streaming && visibleSignals.includes(name);

  const ssl = signals.ssl;
  const sslValue = schemeFact(anatomy, signals);
  if (streaming || (sslValue && !shown("ssl"))) {
    facts.push({
      key: "scheme",
      term: `${anatomy.scheme}://`,
      anchor: "segment",
      value: sslValue ?? (ssl.status === "pending" ? CHECKING : NOTHING),
      pending: !sslValue,
    });
  }

  if (!anatomy.isIp) {
    const whois = signals.whois;
    const ageDays =
      whois.status === "success" && whois.data?.available
        ? whois.data.ageDays
        : null;
    const young = ageDays !== null && ageDays < YOUNG_DOMAIN_DAYS;
    if (streaming || (young && !shown("whois"))) {
      facts.push({
        key: "domain",
        term: anatomy.registeredDomain,
        anchor: "segment",
        value: young
          ? `Registered ${formatAge(ageDays)} ago`
          : whois.status === "pending"
            ? CHECKING
            : NOTHING,
        pending: !young,
      });
    }
  }

  const redirect = signals.redirectChain;
  const destination =
    redirect.status === "success"
      ? redirectDestination(url, redirect.data?.finalUrl)
      : null;
  if (destination && !shown("redirectChain")) {
    facts.push({
      key: "destination",
      term: "Ends at",
      anchor: "label",
      value: <span className="font-mono">{destination}</span>,
    });
  } else if (streaming) {
    // Sized but empty: most links end where they start.
    facts.push({
      key: "destination",
      term: <span aria-hidden="true">&nbsp;</span>,
      anchor: "label",
      value: <span aria-hidden="true">&nbsp;</span>,
      pending: true,
    });
  }

  return facts;
}

/**
 * The certificate fact, only when it is a problem. An unavailable check on
 * an https link means we got no answer (DNS failure, timeout, refusal), so
 * it says exactly that; an http link is unencrypted whatever the probe saw.
 */
function schemeFact(
  anatomy: LinkAnatomy,
  signals: SignalResults,
): string | null {
  const ssl = signals.ssl;
  if (ssl.status !== "success" || !ssl.data) return null;
  if (!ssl.data.available) {
    return anatomy.scheme === "https"
      ? "Couldn't check the certificate"
      : "Not encrypted";
  }
  if (ssl.data.validationState === "warning") {
    return "Encrypted, certificate not fully verified";
  }
  if (ssl.data.validationState === "trusted") return null;
  return "Encrypted, but the certificate isn't trusted";
}

/**
 * One line for history and batch rows: the subdomain truncates from its
 * left, the registered domain never truncates (unless it alone is very
 * long), and the path gives way first. So a look-alike row reads
 * "…com.secure-login.xyz/verify", never "paypal.com.se…". The scheme is
 * omitted. Until the parser loads (or for non-http links) the plain URL
 * shows muted, never a naive split at full emphasis.
 */
export function LinkAnatomyCompact({
  url,
  anatomy,
  className,
}: {
  url: string;
  anatomy: LinkAnatomy | null;
  className?: string;
}) {
  if (!anatomy) {
    return (
      <span
        className={cn(
          "text-meta block min-w-0 truncate font-mono text-[var(--sx-text-muted)]",
          className,
        )}
      >
        {formatDisplayUrl(url)}
      </span>
    );
  }

  const longOwner = anatomy.registeredDomain.length > LONG_DOMAIN;
  return (
    <span
      title={anatomy.href}
      className={cn(
        "text-meta flex min-w-0 items-baseline font-mono",
        className,
      )}
    >
      {/* Flex parts would read as separate words ("malicious. scrutinix.test
          /login"): assistive tech gets the link as one string instead. */}
      <span className="sr-only">
        {formatDisplayUrl(url)}
        {anatomy.impersonates
          ? `, belongs to ${anatomy.registeredDomain}, not ${anatomy.impersonates}`
          : ""}
      </span>
      {anatomy.subdomain ? (
        <span
          dir="rtl"
          aria-hidden="true"
          data-part="subdomain"
          className="min-w-0 shrink truncate text-[var(--sx-text-soft)]"
        >
          <bdi dir="ltr">{anatomy.subdomain}.</bdi>
        </span>
      ) : null}
      <span
        aria-hidden="true"
        data-part="owner"
        className={cn(
          "font-semibold whitespace-nowrap text-[var(--sx-text)]",
          longOwner ? "min-w-0 shrink-[0.01] truncate" : "shrink-0",
        )}
      >
        {anatomy.registeredDomain}
        {anatomy.port}
      </span>
      {anatomy.path ? (
        <span
          aria-hidden="true"
          data-part="path"
          className="min-w-0 shrink-[100] truncate text-[var(--sx-text-soft)]"
        >
          {anatomy.path}
        </span>
      ) : null}
    </span>
  );
}
