import type { ReactNode } from "react";

import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";

/**
 * Prose measure for the public pages: ~65-75 characters per line at the
 * 14px body size. (`65ch` measured ~90 characters - Geist's "0" is wider
 * than its average letter.)
 */
export const PROSE_MEASURE = "max-w-[31rem]";

interface PublicPageShellProps {
  title: string;
  lead: string;
  children: ReactNode;
}

export function PublicPageShell({
  title,
  lead,
  children,
}: PublicPageShellProps) {
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader />

      <main
        id="main-content"
        className="mx-auto w-full max-w-[44rem] flex-1 px-4 pt-10 pb-16 sm:px-6"
      >
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          {title}
        </h1>
        <p
          className={`mt-2 ${PROSE_MEASURE} text-sm leading-6 text-[var(--sx-text-muted)]`}
        >
          {lead}
        </p>

        <div className="mt-10 space-y-10">{children}</div>
      </main>

      <AppFooter />
    </div>
  );
}
