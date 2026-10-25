import type { ReactNode } from "react";

import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";

/**
 * Prose measure for the public pages: 65-75 characters per line at the
 * 15px body size. (`65ch` measures wide in Geist, whose "0" is wider than
 * its average letter, so the measure is set in rem: at 30rem the rendered
 * /about and /privacy lines measure 63-73 characters, checked by counting
 * characters per rendered line rather than by eye.)
 */
export const PROSE_MEASURE = "max-w-[30rem]";

/**
 * Two-column term/description lists: a 10rem term column plus a
 * description column that itself stays within the prose measure.
 */
export const LIST_MEASURE = "max-w-[40rem]";

/** Body copy on the public pages. */
export const PROSE = `${PROSE_MEASURE} text-body text-pretty text-[var(--sx-text-muted)]`;

interface PublicPageShellProps {
  title: string;
  lead: string;
  children: ReactNode;
}

/** Section heading on the public pages: more space above than below. */
export function SectionHeading({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  return (
    <h2
      id={id}
      className="text-title scroll-mt-6 font-semibold text-[var(--sx-text)]"
    >
      {children}
    </h2>
  );
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
        className="mx-auto w-full max-w-[46rem] flex-1 px-4 pt-12 sm:px-6 sm:pt-20"
      >
        <h1 className="text-headline sm:text-display max-w-[36rem] font-semibold text-balance text-[var(--sx-text)]">
          {title}
        </h1>
        <p
          className={`mt-4 ${PROSE_MEASURE} text-lead text-pretty text-[var(--sx-text-muted)]`}
        >
          {lead}
        </p>

        <div className="mt-14 flex flex-col gap-14 border-t border-[var(--sx-border)] pt-12">
          {children}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
