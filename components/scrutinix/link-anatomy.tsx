"use client";

import { Fragment, useState, type ReactNode } from "react";

import { countOf, formatAge } from "@/lib/domain/copy";
import type { LinkAnatomy } from "@/lib/domain/link-anatomy";
import { YOUNG_DOMAIN_DAYS } from "@/lib/domain/signal-severity";
import type { SignalName, SignalResults } from "@/lib/domain/types";
import { formatDisplayUrl, redirectDestination } from "@/lib/domain/url";
import { ownershipSentence } from "@/lib/domain/verdict-guidance";
import { cn } from "@/lib/utils";

/** Longest quiet tail shown before "Show full link". */
const PATH_LIMIT = 48;

/** A registered domain longer than this may wrap or truncate. */
const LONG_DOMAIN = 26;

/**
 * A domain kept whole where it fits: it moves to the next line as a unit,
 * never breaking at its hyphen, and breaks only on a line too narrow for
 * it (a larger text size) rather than run off the page. `trail` is the
 * punctuation that must stay with it. A longer domain breaks anywhere.
 */
function WholeDomain({
  domain,
  className,
  trail = "",
}: {
  domain: string;
  className?: string;
  trail?: string;
}) {
  if (domain.length > LONG_DOMAIN) {
    return (
      <>
        <span className={cn(className, "break-all")}>{domain}</span>
        {trail}
      </>
    );
  }
  return (
    <span className="inline-block max-w-full wrap-anywhere">
      <span className={className}>{domain}</span>
      {trail}
    </span>
  );
}

/** Punctuation that opens `text`, kept with the domain before it. */
function leadingPunctuation(text: string): string {
  return /^[.,;:!?]*/.exec(text)?.[0] ?? "";
}

function shorten(value: string, limit = PATH_LIMIT): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}

/**
 * The link line's size (app/scrutinix.css): reading size on a result, a
 * step down in the form.
 */
const LINK_SIZE = {
  result: "sx-link-result",
  form: "sx-link-form",
} as const;

/**
 * "This link belongs to secure-login.xyz, not paypal.com." built from the
 * shared `ownershipSentence`, set in the serif with the two domains in
 * mono and the owner emphasised. Each domain is its own inline box (kept
 * whole where it fits), which screen readers would read as four stops
 * ("This link belongs to", "secure-login.xyz,", "not", "paypal.com."), so
 * they hear the sentence as one string and the styled one is for the eye.
 * The spoken copy can't be selected, so a copy gives the sentence once.
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
  const between = sentence.slice(ownerAt + registeredDomain.length, brandAt);
  const end = sentence.slice(brandAt + impersonates.length);
  const ownerTrail = leadingPunctuation(between);
  const brandTrail = leadingPunctuation(end);
  return (
    <p className="sx-owner">
      <span className="sr-only select-none">{sentence}</span>
      <span aria-hidden="true">
        {sentence.slice(0, ownerAt)}
        <WholeDomain
          domain={registeredDomain}
          className="font-mono text-[0.86em] font-bold"
          trail={ownerTrail}
        />
        {between.slice(ownerTrail.length)}
        <WholeDomain
          domain={impersonates}
          className="font-mono text-[0.86em]"
          trail={brandTrail}
        />
        {end.slice(brandTrail.length)}
      </span>
    </p>
  );
}

/**
 * A path that wraps between its segments before it breaks inside one (the
 * part wraps anywhere only when a segment alone is wider than the line):
 * a line may end after the "/" (or run of them) that follows a name, so
 * "/verify////…" never splits as "/verif" and "y////", and the leading
 * "/" never stands alone.
 */
function breakablePath(path: string): ReactNode {
  return path.split(/(?<=[^/]\/+)(?=[^/])/).map((segment, index) => (
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {segment}
    </Fragment>
  ));
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
 * certificate" next to a Malicious verdict), and a fact whose evidence is
 * already on screen (`visibleSignals`) is not repeated, nor is its slot
 * held while the scan runs: the result page's Evidence states all eight
 * checks, so there it draws no facts at all, and nothing collapses under
 * the band when the verdict lands.
 *
 * A fact that could still show (its evidence isn't on screen) holds its
 * slot while a scan streams, reading "Checking…" until its check lands;
 * empty slots collapse when the scan ends.
 *
 * `anatomy` is null until the Public Suffix List has loaded (a shared link
 * gets it from the server); the mono URL shows meanwhile, never a naive
 * split.
 *
 * No `title` on the link: Chrome on Android reads a title as the line's
 * whole text, so TalkBack spoke the bare URL and never the part names.
 * "Show full link" shows the rest of a long one.
 */
export function LinkAnatomyView({
  url,
  anatomy,
  signals,
  visibleSignals = [],
  streaming = false,
  id = "sx-link-anatomy",
  size = "result",
}: {
  url: string;
  anatomy: LinkAnatomy | null;
  signals?: SignalResults | null;
  /** Evidence rows on screen: their facts are not repeated here. */
  visibleSignals?: readonly SignalName[];
  /** The scan is running: hold every fact slot open. */
  streaming?: boolean;
  /** Element id of the link line (the form's own breakdown needs its own). */
  id?: string;
  /** The result's link at reading size, or the form's a step down. */
  size?: keyof typeof LINK_SIZE;
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === url;
  const facts =
    signals && anatomy
      ? getAnatomyFacts(url, anatomy, signals, visibleSignals, streaming)
      : [];
  const truncates = Boolean(anatomy && anatomy.path.length > PATH_LIMIT);

  return (
    <div className="flex flex-col gap-4">
      {anatomy ? (
        <CaptionedLink
          id={id}
          anatomy={anatomy}
          path={expanded ? anatomy.path : shorten(anatomy.path)}
          className={LINK_SIZE[size]}
        />
      ) : (
        <p
          id={id}
          className={cn(
            LINK_SIZE[size],
            "font-mono break-words text-[var(--sx-text-soft)]",
          )}
        >
          <span className="break-all text-[var(--sx-text-muted)]">{url}</span>
        </p>
      )}

      {truncates ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpandedFor(expanded ? null : url)}
          className="text-meta sx-link -my-2.5 inline-flex min-h-11 items-center self-start"
        >
          {expanded ? "Shorten link" : "Show full link"}
        </button>
      ) : null}

      {anatomy?.impersonates ? (
        <OwnershipSentence
          registeredDomain={anatomy.registeredDomain}
          impersonates={anatomy.impersonates}
        />
      ) : null}

      {facts.length > 0 ? (
        <dl className="text-meta sm:text-body grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-5 gap-y-1.5">
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

/**
 * The link with each part named beneath it. Parts wrap as units, so a
 * caption always stays under the text it names; long parts break inside
 * their own column. Assistive technology hears each part after its name
 * ("Registered domain: secure-login.xyz"), in the link's own order, so the
 * breakdown isn't only visual.
 */
function CaptionedLink({
  id,
  anatomy,
  path,
  className,
}: {
  id: string;
  anatomy: LinkAnatomy;
  path: string;
  className?: string;
}) {
  const userinfo = `${anatomy.userinfo}@`;
  const subdomain = `${anatomy.subdomain}.`;
  return (
    <p
      id={id}
      className={cn(
        "sx-anat",
        hasShortMiddlePart(anatomy, path) && "sx-anat-stacked",
        className,
      )}
    >
      {/* Phones stack the named parts; the bare scheme steps out of sight
          there (the certificate fact below still speaks for it). */}
      <span className="max-sm:sr-only">{`${anatomy.scheme}://`}</span>
      {anatomy.userinfo ? (
        <LinkPart caption="Ignored by browsers" spoken={userinfo}>
          <span className="break-all line-through">{userinfo}</span>
        </LinkPart>
      ) : null}
      {anatomy.subdomain ? (
        <LinkPart caption="A label anyone can add" spoken={subdomain}>
          <span className="break-all text-[var(--sx-text-muted)]">
            {subdomain}
          </span>
        </LinkPart>
      ) : null}
      <LinkPart
        caption="Registered domain"
        spoken={anatomy.registeredDomain}
        owner
      >
        <WholeDomain
          domain={anatomy.registeredDomain}
          className="font-bold text-[var(--sx-text)]"
        />
      </LinkPart>
      {anatomy.port ? <span>{anatomy.port}</span> : null}
      {path ? (
        <LinkPart caption="A page on that domain" spoken={path}>
          <span className="wrap-anywhere">{breakablePath(path)}</span>
        </LinkPart>
      ) : null}
    </p>
  );
}

/**
 * Whether a captioned part with another after it is too short to carry its
 * caption inline. The caption never widens its part, so its longest word
 * must fit over the part's text at the form's smaller size: "anyone" over
 * four mono characters, "browsers" over five, "Registered" over seven.
 * Otherwise the link is shown stacked, as on phones.
 */
function hasShortMiddlePart(anatomy: LinkAnatomy, path: string): boolean {
  const middle: [string | null, number][] = [
    [anatomy.userinfo ? `${anatomy.userinfo}@` : null, 5],
    [anatomy.subdomain ? `${anatomy.subdomain}.` : null, 4],
    [path ? anatomy.registeredDomain : null, 7],
  ];
  return middle.some(([part, min]) => part !== null && part.length < min);
}

/**
 * One named part: its text over a hairline bracket carrying the caption
 * (heavy for the registered domain). The caption never widens its part,
 * so the link stays one continuous line of text. Screen readers hear the
 * part as one string after its name (`spoken`): the drawn text is split
 * into boxes (a domain kept whole, a path's break points) that would read
 * as separate stops. The spoken copy can't be selected, so a copy gives
 * the link as drawn. It opens with a comma and a no-break space: TalkBack
 * reads the line as one string and ran the parts together ("…safe.Registered
 * domain: scrutinix.testA page…"), and an ordinary space at the edge of
 * the `sr-only` box is dropped.
 */
function LinkPart({
  caption,
  spoken,
  owner = false,
  children,
}: {
  caption: string;
  spoken: string;
  owner?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={cn("sx-anat-part", owner && "sx-anat-owner")}>
      <span className="sr-only select-none">{`,\u00a0${caption}: ${spoken}`}</span>
      <span aria-hidden="true" className="sx-anat-text">
        {children}
      </span>
      <span aria-hidden="true" className="sx-anat-caption">
        {caption}
      </span>
    </span>
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
  // Evidence on screen states the fact, so it neither shows here nor holds
  // a slot while the scan runs (a held slot would collapse under the band
  // when the verdict lands).
  const shown = (name: SignalName) => visibleSignals.includes(name);

  const ssl = signals.ssl;
  const sslValue = schemeFact(anatomy, signals);
  if (!shown("ssl") && (streaming || sslValue)) {
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
    if (!shown("whois") && (streaming || young)) {
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
  } else if (streaming && !shown("redirectChain")) {
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
      className={cn(
        "text-meta flex min-w-0 items-baseline font-mono",
        className,
      )}
    >
      {/* Flex parts would read as separate words ("malicious. scrutinix.test
          /login"): assistive tech gets the link as one string instead. */}
      <span className="sr-only">
        {spokenLink(formatDisplayUrl(url))}
        {anatomy.impersonates
          ? `, belongs to ${anatomy.registeredDomain}, not ${anatomy.impersonates}`
          : ""}
      </span>
      {/* The full link on hover, where the row truncates it; hidden from
          assistive technology, which hears the string above. Each drawn
          part hides itself too: WebKit ignores aria-hidden on this
          `display: contents` wrapper, and Safari read the drawn link after
          the spoken one. */}
      <span aria-hidden="true" title={anatomy.href} className="contents">
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
    </span>
  );
}

/** Path characters a row speaks before it says how many more there are. */
const SPOKEN_PATH = 40;

/** Four or more of one symbol in a row ("////"): a reader says each one. */
const SYMBOL_RUN = /([^\p{L}\p{N}])\1{3,}/gu;

/**
 * A row's link as spoken: a path up to 48 characters exactly as it is;
 * a longer one as its first 40 characters, any run of one symbol in them
 * said once, then how much is left ("…/verify/, and 1471 more
 * characters"). So a very long link costs seconds of speech (TalkBack
 * spent 13 s on 40 characters that were mostly slashes). The host is
 * always said exactly.
 */
export function spokenLink(display: string): string {
  const pathAt = display.indexOf("/");
  if (pathAt < 0 || display.length - pathAt <= PATH_LIMIT) return display;
  const shown = pathAt + SPOKEN_PATH;
  return `${display.slice(0, pathAt)}${display
    .slice(pathAt, shown)
    .replace(
      SYMBOL_RUN,
      "$1",
    )}, and ${countOf(display.length - shown, "more character")}`;
}
