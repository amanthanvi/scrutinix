import Link from "next/link";
import type { ReactNode } from "react";

interface AppFooterProps {
  children?: ReactNode;
}

const LINK =
  "inline-flex min-h-11 items-center transition-colors hover:text-[var(--sx-text)]";

export function AppFooter({ children }: AppFooterProps) {
  return (
    <footer className="mt-16 border-t border-[var(--sx-border)]">
      <div className="text-meta mx-auto flex w-full max-w-[46rem] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-4 text-[var(--sx-text-soft)] sm:px-6">
        <span className="font-medium text-[var(--sx-text-muted)]">
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
