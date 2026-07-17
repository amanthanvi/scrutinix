import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";
import { Button } from "@/components/ui/button";

interface ProofRow {
  label: string;
  value: string;
  body: string;
  icon?: LucideIcon;
}

interface PublicPageShellProps {
  eyebrow: string;
  title: string;
  lead: string;
  proofRows: readonly ProofRow[];
  children: ReactNode;
}

export function PublicPageShell({
  eyebrow,
  title,
  lead,
  proofRows,
  children,
}: PublicPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main id="main-content" className="relative z-10 flex-1 pb-10">
        <div className="sx-atmosphere" />

        <section className="border-border border-b">
          <div className="relative z-10 mx-auto max-w-[1520px] px-4 pt-6 pb-8 sm:px-6 sm:pb-10 xl:px-8 xl:pt-8">
            <div className="sx-stage-in" data-delay="0">
              <Button asChild variant="ghost" className="h-8 px-3">
                <Link href="/">
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Back to scanner
                </Link>
              </Button>
            </div>

            <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(18rem,0.75fr)] lg:items-start">
              <div className="sx-stage-in space-y-5" data-delay="1">
                <p className="text-sm font-medium text-[var(--sx-accent)]">
                  {eyebrow}
                </p>
                <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-[var(--sx-text)] sm:text-5xl lg:text-6xl">
                  {title}
                </h1>
                <p className="max-w-3xl text-base leading-8 text-[var(--sx-text-muted)]">
                  {lead}
                </p>
              </div>

              <div
                className="sx-stage-in grid gap-3 md:grid-cols-3 lg:grid-cols-1"
                data-delay="2"
              >
                {proofRows.map((row) => {
                  const Icon = row.icon;
                  return (
                    <div
                      key={row.label}
                      className="border-border bg-card rounded-lg border px-4 py-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--sx-active-accent)]"
                    >
                      <div className="flex items-start gap-3">
                        {Icon ? (
                          <Icon
                            className="mt-0.5 h-4 w-4 shrink-0 text-[var(--sx-accent)]"
                            aria-hidden="true"
                          />
                        ) : null}
                        <div>
                          <p className="text-xs text-[var(--sx-text-muted)]">
                            {row.label}
                          </p>
                          <p className="mt-2 text-xl font-semibold text-[var(--sx-text)]">
                            {row.value}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-[var(--sx-text-muted)]">
                            {row.body}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1520px] px-4 py-8 sm:px-6 xl:px-8 xl:py-10">
          {children}
        </section>
      </main>

      <AppFooter>
        <div className="flex w-full flex-wrap items-center justify-end gap-x-5 gap-y-1 text-[11px] text-[var(--sx-text-muted)]">
          <span>Hash-only logs</span>
          <span className="text-[var(--sx-border-muted)]">/</span>
          <span>Browser-only history</span>
          <span className="text-[var(--sx-border-muted)]">/</span>
          <span>No share database</span>
        </div>
      </AppFooter>
    </div>
  );
}
