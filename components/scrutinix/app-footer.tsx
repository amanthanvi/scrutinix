import Link from "next/link";
import type { ReactNode } from "react";

interface AppFooterProps {
  children: ReactNode;
}

export function AppFooter({ children }: AppFooterProps) {
  return (
    <footer className="border-border relative z-10 border-t bg-[color-mix(in_srgb,var(--sx-bg-strong)_55%,transparent)]">
      <div className="mx-auto flex max-w-[1520px] flex-col gap-3 px-4 py-3.5 sm:px-6 xl:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="sx-font-sans text-sm font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
              Scrutinix
            </span>
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center gap-x-4 gap-y-2"
            >
              <Link
                href="/about"
                className="text-sm text-[var(--sx-text-muted)] transition-colors hover:text-[var(--sx-text)]"
              >
                Method
              </Link>
              <Link
                href="/privacy"
                className="text-sm text-[var(--sx-text-muted)] transition-colors hover:text-[var(--sx-text)]"
              >
                Privacy
              </Link>
            </nav>
          </div>

          <div className="min-w-0 flex-1 text-xs text-[var(--sx-text-muted)] lg:text-right">
            {children}
          </div>
        </div>
      </div>
    </footer>
  );
}
