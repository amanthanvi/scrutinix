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

import { RadarWatermark } from "@/components/scrutinix/radar-watermark";
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
  }
}

export function IntroPanel({ dock }: IntroPanelProps) {
  return (
    <section
      aria-labelledby="scrutinix-intro-heading"
      className="border-border relative overflow-hidden border-b"
    >
      <RadarWatermark />
      <div className="relative z-10 mx-auto max-w-[1520px] px-4 py-8 sm:px-6 sm:py-10 xl:px-8 xl:py-12">
        <div className="sx-home-hero grid gap-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.08fr)] lg:items-start">
          <div className="min-w-0 lg:pr-2">
            <div className="sx-home-brand sx-stage-in space-y-5" data-delay="0">
              <div className="space-y-3">
                <h1
                  id="scrutinix-intro-heading"
                  className="text-4xl font-semibold tracking-[-0.04em] text-[var(--sx-text)] sm:text-5xl lg:text-6xl"
                >
                  Scrutinix
                </h1>
                <p className="max-w-xl text-xl leading-tight font-medium text-[var(--sx-text)] sm:text-2xl">
                  Vigilance on demand.
                </p>
              </div>

              <p className="sx-home-secondary-copy max-w-xl text-sm leading-6 text-[var(--sx-text-muted)] sm:text-base">
                Unified threat intelligence with automated batch processing,
                private logging, and integrated reporting controls.
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {referenceCards.map(({ body, cta, href, icon: Icon, title, tone }) => (
          <div
            key={title}
            className="sx-panel border-border rounded-xl border px-4 py-4"
          >
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
