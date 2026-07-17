import Link from "next/link";
import {
  Link2,
  Lock,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface IntroPanelProps {
  dock?: ReactNode;
}

type ReferenceTone = "accent" | "info" | "suspicious";

interface ReferenceCard {
  title: string;
  body: string;
  icon: LucideIcon;
  href: string;
  cta: string;
  tone: ReferenceTone;
}

const referenceCards: ReferenceCard[] = [
  {
    title: "Weighted evidence",
    body: "High-signal reputation sources outrank softer context so the verdict stays conservative.",
    icon: ShieldCheck,
    href: "/about",
    cta: "How scoring works",
    tone: "accent",
  },
  {
    title: "Browser-only history",
    body: "Saved scans stay on-device unless you export or share them.",
    icon: Lock,
    href: "/privacy",
    cta: "Privacy details",
    tone: "info",
  },
  {
    title: "Batch stays isolated",
    body: "Queue short lists, then open any finished row in single-scan mode.",
    icon: Workflow,
    href: "/#scan-console",
    cta: "Open the console",
    tone: "accent",
  },
  {
    title: "Weighted signals first",
    body: "Safe Browsing, feeds, and multi-engine hits outrank passive DNS or domain-age context.",
    icon: ShieldAlert,
    href: "/about",
    cta: "Scoring",
    tone: "accent",
  },
  {
    title: "Summary vs full",
    body: "Summary prioritizes the highest-impact lanes; full shows every outcome, including caveats.",
    icon: Sparkles,
    href: "/about",
    cta: "Lanes",
    tone: "info",
  },
  {
    title: "Confidence caps",
    body: "Clean verdicts lose confidence when primary reputation coverage does not complete.",
    icon: Scale,
    href: "/about",
    cta: "Confidence",
    tone: "suspicious",
  },
  {
    title: "Feed hits need the full URL",
    body: "URLhaus and OpenPhish match the exact IOC string you paste, not browse pages like urlhaus.abuse.ch/browse/.",
    icon: Link2,
    href: "/about",
    cta: "How feeds work",
    tone: "info",
  },
];

function iconToneClass(tone: ReferenceTone) {
  switch (tone) {
    case "accent":
      return "text-[var(--sx-accent)]";
    case "info":
      return "text-[var(--sx-info)]";
    case "suspicious":
      return "text-[var(--sx-suspicious)]";
    default: {
      const _exhaustive: never = tone;
      return _exhaustive;
    }
  }
}

export function IntroPanel({ dock }: IntroPanelProps) {
  return (
    <section
      aria-labelledby="scrutinix-intro-heading"
      className="border-border relative overflow-hidden border-b"
    >
      <div className="relative z-10 mx-auto max-w-[1520px] px-4 py-8 sm:px-6 sm:py-10 xl:px-8 xl:py-12">
        <div className="sx-home-hero grid gap-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.08fr)] lg:items-start">
          <div className="min-w-0 lg:pr-2">
            <div className="sx-home-brand space-y-6">
              <div className="space-y-4">
                <p className="sx-label">Public scanner</p>
                <h1
                  id="scrutinix-intro-heading"
                  className="text-[2.75rem] leading-[0.95] font-semibold tracking-[-0.03em] text-balance text-[var(--sx-text)] sm:text-6xl lg:text-[4.25rem]"
                >
                  Scrutinix
                </h1>
                <p className="max-w-[22ch] text-xl leading-snug font-medium tracking-[-0.02em] text-[var(--sx-text)] sm:text-2xl">
                  Check a link before you forward it.
                </p>
              </div>

              <p className="sx-home-secondary-copy max-w-[42ch] text-sm leading-7 text-[var(--sx-text-muted)] sm:text-[0.95rem]">
                Eight independent signals stream into one verdict — reputation,
                ML, TLS, DNS, and more — with private on-device history.
              </p>
            </div>
          </div>

          {dock ? <div className="min-w-0">{dock}</div> : null}
        </div>
      </div>
    </section>
  );
}

export function HomeSupportSection() {
  return (
    <section
      aria-labelledby="home-support-heading"
      className="border-border border-t pt-8"
    >
      <h2 id="home-support-heading" className="sr-only">
        Method and reference
      </h2>
      <div className="sx-surface-block border-border grid gap-px overflow-hidden rounded-md border bg-[var(--sx-border)] sm:grid-cols-2 lg:grid-cols-3">
        {referenceCards.map(({ body, cta, href, icon: Icon, title, tone }) => (
          <div key={title} className="bg-[var(--sx-surface)] px-4 py-4">
            <div className="flex items-start gap-2.5">
              <Icon
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconToneClass(tone)}`}
                aria-hidden="true"
              />
              <div className="min-w-0 space-y-1.5">
                <h3 className="text-sm leading-snug font-medium text-[var(--sx-text)]">
                  {title}
                </h3>
                <p className="text-xs leading-relaxed text-[var(--sx-text-muted)]">
                  {body}
                </p>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                >
                  <Link href={href}>{cta}</Link>
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
