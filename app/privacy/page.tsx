import type { Metadata } from "next";

import {
  PROSE,
  PublicPageShell,
  SectionHeading,
} from "@/components/scrutinix/public-page-shell";

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
    body: "To check a link, our server sends it to VirusTotal, Google Safe Browsing, and the abuse.ch threat feeds (URLhaus and ThreatFox). It sends the domain name to the Spamhaus and SURBL blocklists and the domain registry (WHOIS). It also visits the site to read its security certificate, DNS records, and redirects. Each of these services handles the link under its own privacy policy. We keep each result for about 15 minutes so a repeat check is fast. We never store your history.",
  },
  {
    title: "Logging",
    body: "Our logs keep timings and a scrambled fingerprint of the link, never the link itself.",
  },
  {
    title: "Shared links",
    body: "A shared link carries the result inside the link itself: the verdict, the link, a one-line summary, and the eight check results. We have no database of shared links. When a chat app previews a shared link, our server draws the preview image from what is in the link and doesn't save it, though the image may be cached for up to a day so previews load fast. A shared result shows one moment in time, so run a new scan to check again.",
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
