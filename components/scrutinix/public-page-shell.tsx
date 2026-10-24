import type { ReactNode } from "react";

import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";

/**
 * Prose measure for the public pages: 65-75 characters per line at the
 * 16px body size in the system sans (checked by counting characters per
 * rendered line, not by eye: `ch` measures the "0", which runs wider than
 * the average letter).
 */
export const PROSE_MEASURE = "max-w-[32rem]";

/**
 * Two-column term/description lists: a 10rem term column plus a
 * description column that itself stays within the prose measure.
 */
export const LIST_MEASURE = "max-w-[48rem]";

/** Body copy on the public pages. */
export const PROSE = `${PROSE_MEASURE} text-body text-pretty text-[var(--sx-text-muted)]`;

interface PublicPageShellProps {
  title: string;
  lead: string;
  children: ReactNode;
}

/** Section heading on the public pages: the serif, more space above than below. */
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
      className="sm:text-title scroll-mt-6 font-serif text-[1.5rem] leading-[1.15] font-semibold tracking-[-0.015em] text-balance text-[var(--sx-text)]"
    >
      {children}
    </h2>
  );
}

/**
 * A wide table's frame: it scrolls sideways on its own on a phone rather
 * than widening the page, and takes focus so the keyboard can scroll it.
 * Tables inside the shell are styled from `app/scrutinix.css` (hairline
 * rows under an ink header rule, tabular figures), so plain `<table>`
 * markup needs no classes.
 */
export function TableFrame({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      // A scroll container must take focus for keyboard users (axe
      // scrollable-region-focusable); the region role names it.
      // eslint-disable-next-line jsx-a11y-x/no-noninteractive-tabindex
      tabIndex={0}
      className="sx-table-frame -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      {children}
    </div>
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
        className="sx-public mx-auto w-full max-w-[71rem] flex-1 px-4 pt-12 sm:px-6 sm:pt-24"
      >
        <h1 className="max-w-[50rem] font-serif text-[clamp(2.5rem,1.6rem+3.6vw,4.25rem)] leading-[1.02] font-semibold tracking-[-0.024em] text-balance text-[var(--sx-text)]">
          {title}
        </h1>
        <p className="mt-5 max-w-[37.5rem] font-serif text-[1.125rem] leading-[1.45] text-pretty text-[var(--sx-text-muted)] sm:mt-7 sm:text-[1.375rem]">
          {lead}
        </p>

        <div className="mt-12 flex flex-col gap-14 border-t border-[var(--sx-border)] pt-12 sm:mt-16 sm:gap-16 sm:pt-14">
          {children}
        </div>
      </main>

      <AppFooter />
    </div>
  );
}
