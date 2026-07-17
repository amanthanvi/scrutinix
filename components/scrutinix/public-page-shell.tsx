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
  /** Quiet section label, e.g. "Method" or "Privacy" */
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
    <div className="relative flex min-h-screen flex-col">
      <AppHeader />

      <main id="main-content" className="relative z-10 flex-1 pb-12">
        <header className="border-border border-b">
          <div className="mx-auto max-w-[1520px] px-4 pt-6 pb-10 sm:px-6 sm:pb-12 xl:px-8 xl:pt-8">
            <Button asChild variant="ghost" className="h-8 px-3">
              <Link href="/">
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to scanner
              </Link>
            </Button>

            <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(16rem,0.7fr)] lg:items-end lg:gap-14">
              <div className="min-w-0 space-y-5">
                <p className="sx-label">{eyebrow}</p>
                <h1 className="max-w-[18ch] text-[2.25rem] leading-[1.12] font-semibold tracking-[-0.03em] text-balance text-[var(--sx-text)] sm:text-5xl lg:text-[3.25rem]">
                  {title}
                </h1>
                <p className="max-w-[62ch] text-base leading-7 text-[var(--sx-text-muted)] sm:text-[1.05rem] sm:leading-8">
                  {lead}
                </p>
              </div>

              <aside
                aria-label={`${eyebrow} highlights`}
                className="sx-surface-block border-border overflow-hidden rounded-md border"
              >
                <div className="border-border border-b bg-[color-mix(in_srgb,var(--sx-border-muted)_10%,transparent)] px-4 py-2.5">
                  <p className="sx-label">Highlights</p>
                </div>
                <ul className="divide-border divide-y">
                  {proofRows.map((row) => {
                    const Icon = row.icon;
                    return (
                      <li key={row.label} className="px-4 py-4">
                        <div className="flex items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {Icon ? (
                                <Icon
                                  className="h-3.5 w-3.5 shrink-0 text-[var(--sx-text-soft)]"
                                  aria-hidden="true"
                                />
                              ) : null}
                              <p className="text-xs text-[var(--sx-text-muted)]">
                                {row.label}
                              </p>
                            </div>
                            <p className="mt-1.5 text-base font-semibold tracking-[-0.015em] text-[var(--sx-text)]">
                              {row.value}
                            </p>
                            <p className="mt-1.5 text-sm leading-6 text-[var(--sx-text-muted)]">
                              {row.body}
                            </p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </aside>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1520px] px-4 py-10 sm:px-6 xl:px-8 xl:py-12">
          {children}
        </div>
      </main>

      <AppFooter>
        <p className="sx-font-hack w-full text-right text-[11px] text-[var(--sx-text-soft)]">
          Hash-only logs · Browser-only history · No share database
        </p>
      </AppFooter>
    </div>
  );
}
