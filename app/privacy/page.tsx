import type { Metadata } from "next";

import {
  PROSE,
  PublicPageShell,
  SectionHeading,
} from "@/components/scrutinix/public-page-shell";
import { SHARE_MAX_AGE_WORDS } from "@/lib/domain/signal-signature";

export const metadata: Metadata = {
  title: "Scrutinix Privacy",
  description:
    "What Scrutinix keeps in your browser, which services check your link, and how shared links work.",
};

const sections = [
  {
    title: "What stays local",
    body: "Finished scans are saved in your browser on this device only, one entry per link. A new scan of the same link replaces the older one. Clearing history removes them, and you can undo that right away.",
  },
  {
    title: "What the server does",
    body: "To check a link, our server sends it to VirusTotal, Google Safe Browsing, and the abuse.ch URLhaus feed, and sends its hostname to the abuse.ch ThreatFox feed. It sends the domain name to the Spamhaus and SURBL blocklists, and to rdap.org, which passes the registration lookup on to the domain's registry (WHOIS). It sends only the IP address of the link's server to Team Cymru, to learn which network it belongs to. It downloads the OpenPhish list and matches the link against it on our server, so the link is not sent to OpenPhish. It also visits the site to read its security certificate and redirects, and looks up its DNS records. Each of these services handles what it receives under its own privacy policy. We never store your history.",
  },
  {
    title: "Private and one-time links",
    body: "Checking a link visits it, the way a browser would. That can use up a one-time link, such as a password reset or a sign-in link, so check those only if you are willing to lose them. If VirusTotal has never seen a link before, it scans it, and the link can then become visible to VirusTotal's users.",
  },
  {
    title: "Cached results",
    body: "When every check completes, we keep the result for 15 minutes so a repeat check is fast. If any check failed or the scan was stopped, we don't keep the result, so checking again runs every check again. Some checks reuse reference data they downloaded recently: the OpenPhish list for up to 15 minutes, and the names of networks for up to a day. When the shared cache is on, it deletes the result after those 15 minutes. A copy in the server's memory is never reused after 15 minutes, but it can stay in memory until the same link is checked again, newer results crowd it out, or the server restarts.",
  },
  {
    title: "Logging",
    body: "Our logs keep timings and a scrambled fingerprint of the link, never the link itself. Our hosting provider keeps its own record of the pages requested, so a link carried in a page's address, such as a link opened with ?url= (including after you share one to Scrutinix) or a shared result, can appear in its request logs for a limited time under its own policy.",
  },
  {
    title: "Rate limits",
    body: "To limit how many checks one connection can run, we count requests by IP address. When the shared rate limiter is on, it stores that IP address with each count, and the counts expire after about 2 minutes (the per-minute limit) and about 48 hours (the daily limit). Otherwise the counts stay in the server's memory.",
  },
  {
    title: "Shared links",
    body: `A shared link carries the result inside the link itself: the verdict, the link, a one-line summary, and the eight check results. We have no database of shared links. Our server signs each link it creates, so it can tell its own results from edited ones: a link without a valid signature opens as a link to check yourself, with no verdict and no preview of one. Opening a shared link sends it to our server so it can check the signature; the link inside is not scanned unless you choose to scan it. When a chat app previews a signed link, our server draws the preview image from what is in the link and doesn't save it, though the image may be cached for up to an hour so previews load fast. A shared result shows one moment in time, so a signed link shows its result for ${SHARE_MAX_AGE_WORDS} after the check, then opens as a link to check yourself.`,
  },
  {
    title: "Sharing to Scrutinix",
    body: "When you share a link to Scrutinix from your phone, your phone sends what you shared to our server, which keeps only the first web link, discards the rest, and logs none of it. Scrutinix opens with that link filled in and taken apart, and checks it only when you tap Analyze. A link that opens Scrutinix with a link filled in, from a bookmarklet, a Shortcut, or another site, works the same way.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <PublicPageShell
      title="Your history stays in your browser."
      lead="To check a link, our server visits it and asks outside services about it. Your history stays in your browser, and shared links carry their result inside the link."
    >
      {sections.map((section) => (
        <section key={section.title} className="flex flex-col gap-4">
          <SectionHeading>{section.title}</SectionHeading>
          <p className={PROSE}>{section.body}</p>
        </section>
      ))}
    </PublicPageShell>
  );
}
