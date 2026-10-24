import Link from "next/link";
import type { ReactNode } from "react";

interface AppFooterProps {
  children?: ReactNode;
}

const LINK =
  "inline-flex min-h-11 min-w-11 items-center justify-center text-[var(--sx-text-muted)] transition-colors hover:text-[var(--sx-text)]";

export function AppFooter({ children }: AppFooterProps) {
  return (
    <footer className="mt-20 border-t border-[var(--sx-border)] sm:mt-24">
      <div className="text-meta mx-auto flex w-full max-w-[71rem] flex-wrap items-center gap-x-5 gap-y-1 px-4 pt-2 pb-4 text-[var(--sx-text-soft)] sm:min-h-[4.75rem] sm:px-6 sm:py-0">
        <span className="mr-1 font-serif text-[1.0625rem] leading-none font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
          Scrutinix
        </span>
        <nav aria-label="Footer" className="flex items-center gap-x-5">
          <Link href="/about" className={LINK}>
            About
          </Link>
          <Link href="/privacy" className={LINK}>
            Privacy
          </Link>
          <a
            href="https://github.com/amanthanvi/scrutinix"
            className={LINK}
            rel="noreferrer"
          >
            Source
          </a>
        </nav>
        <span className="sm:ml-auto">
          {children ?? "Free and open source. No account needed."}
        </span>
      </div>
    </footer>
  );
}
