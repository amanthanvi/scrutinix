import type { Metadata } from "next";

import { PublicPageShell } from "@/components/scrutinix/public-page-shell";

export const metadata: Metadata = {
  title: "Scrutinix Privacy",
  description:
    "Which services receive a URL you submit, what the server fetches, and what stays on your device.",
};

const recipients = [
  {
    name: "VirusTotal",
    body: "The full URL, when an API key is configured. A URL VirusTotal already knows is only looked up. A URL it does not know is submitted for analysis. Those reports are shared with the public VirusTotal community, and the submitted page may be shared with premium VirusTotal customers. The public report address is derived from the URL. Scrutinix does not use VirusTotal's private scanning mode.",
  },
  {
    name: "Google Safe Browsing",
    body: "The full URL, when an API key is configured. Google receives the raw URL, not a hash, and can see which URL was checked.",
  },
  {
    name: "URLhaus",
    body: "The full URL, sent to abuse.ch. When that exact URL is not listed, the hostname is sent as well.",
  },
  {
    name: "ThreatFox",
    body: "The hostname only, sent to abuse.ch when an abuse.ch key is configured. The path and query string are not included.",
  },
  {
    name: "OpenPhish",
    body: "None of your URL. The server downloads the public community feed and matches it locally.",
  },
  {
    name: "Spamhaus DBL",
    body: "The registrable domain — example.com in https://login.example.com/reset — queried over DNS. The path is not included, and an IP address is not queried. The resolver and Spamhaus both see that domain.",
  },
  {
    name: "SURBL",
    body: "The same registrable domain, queried over DNS. The resolver and SURBL both see that domain, and an IP address is not queried.",
  },
  {
    name: "rdap.org",
    body: "The registrable domain, for public registration data. rdap.org forwards the request to the domain's registry, which sees the same name. An IP address is not sent.",
  },
  {
    name: "DNS resolver",
    body: "The hostname, for address, mail, name-server, and text records, using this server's DNS resolver. A scan of an IP address sends that IP for a reverse lookup instead.",
  },
  {
    name: "The host in the URL",
    body: "The full URL, in a request this server makes. The next section describes that fetch.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <PublicPageShell
      title="What leaves this browser."
      lead="Saved history stays on your device. The URL you submit is sent to this server and to the services below, and the server fetches the page itself."
    >
      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Do not scan private or one-time links
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Do not submit a password-reset link, a magic-login link, a private
          document share, or any other URL with a secret in it. The server
          requests that page, which can use the link up. If the URL is new to
          VirusTotal, submitting it publishes a report the VirusTotal community
          can see.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          What stays on this device
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Completed scans are stored in IndexedDB on your device only. Clearing
          history removes that archive, with an immediate undo in the same
          session. The machine-learning score is computed on the server by a
          bundled model; the URL is not sent to a hosted model.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Who receives a URL
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Each URL in a batch is handled the same way. A #fragment is not
          forwarded to these services: a single scan removes it in the browser,
          and a batch request can still carry it to this server, which drops it
          before any lookup. VirusTotal and Google Safe Browsing are not
          contacted when this deployment has no API key for them. ThreatFox is
          not contacted when no abuse.ch key is configured. A source that was
          not contacted is reported as missing coverage. Local and private
          addresses are rejected and are not forwarded.
        </p>
        <dl className="max-w-[65ch] space-y-4 text-sm leading-6">
          {recipients.map((recipient) => (
            <div key={recipient.name} className="space-y-1">
              <dt className="font-medium text-[var(--sx-text)]">
                {recipient.name}
              </dt>
              <dd className="text-[var(--sx-text-muted)]">{recipient.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          The server fetches the page
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          To follow redirects, the server sends up to five HTTP GET requests
          along the chain, counting the original URL. Each request includes the
          path and query string and identifies itself as scrutinix/3.0. When the
          final page is HTML, the server reads up to 64 KB of it. That GET can
          sign someone in, accept an invite, or otherwise consume a one-time
          link. A separate connection checks the certificate and sends the
          hostname only, not the path or query.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Cache
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          A scan that finishes without missing coverage is kept for up to 15
          minutes, including the URL, so a repeat can skip the providers. The
          copy is held in memory on the server and, when shared caching is
          configured, in Upstash Redis. The Redis key is a hash of the URL, not
          the URL itself. Incomplete, failed, and cancelled scans are not
          cached. History on your device is never uploaded.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Logging
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Application logs record a short hash of the URL, the scan id, timings,
          the verdict, and whether the result was cached. They do not record the
          raw URL.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Rate limits
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Requests are counted by IP address. When shared rate limiting is
          configured, that IP is stored in Upstash Redis for a one-minute window
          and a one-day window. Otherwise the counters stay in the server
          process.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Shared links
        </h2>
        <p className="max-w-[65ch] text-sm leading-6 text-[var(--sx-text-muted)]">
          Share links embed a browser-generated snapshot in the URL itself —
          there is no server-side share database. A snapshot is a point-in-time
          record; run a fresh scan to verify against current provider responses.
        </p>
      </section>
    </PublicPageShell>
  );
}
