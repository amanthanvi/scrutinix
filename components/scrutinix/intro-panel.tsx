import type { ReactNode } from "react";

interface IntroPanelProps {
  dock?: ReactNode;
}

export function IntroPanel({ dock }: IntroPanelProps) {
  return (
    <section
      aria-labelledby="scrutinix-intro-heading"
      className="border-border relative overflow-hidden border-b"
    >
      <div className="relative z-10 mx-auto max-w-[1520px] px-4 py-8 sm:px-6 sm:py-10 xl:px-8 xl:py-12">
        <div className="grid gap-6 lg:grid-cols-[minmax(18rem,0.72fr)_minmax(0,1.08fr)] lg:items-start">
          <div className="min-w-0 lg:pr-2">
            <div className="space-y-7">
              <div className="space-y-5">
                <h1
                  id="scrutinix-intro-heading"
                  className="text-[2.85rem] leading-[0.92] font-bold tracking-[-0.03em] text-balance text-[var(--sx-text)] uppercase sm:text-6xl lg:text-[4.5rem]"
                >
                  Scrutinix
                </h1>
                <p className="max-w-[18ch] text-lg leading-snug font-medium tracking-[-0.015em] text-[var(--sx-text)] sm:text-xl">
                  Calmly check links. Know before you click.
                </p>
              </div>

              <p className="sx-home-secondary-copy max-w-[40ch] text-sm leading-7 text-[var(--sx-text-muted)]">
                Paste a sketchy URL before you forward it. Eight signals stream
                into one verdict — with private on-device history.
              </p>
            </div>
          </div>

          {dock ? <div className="min-w-0">{dock}</div> : null}
        </div>
      </div>
    </section>
  );
}
