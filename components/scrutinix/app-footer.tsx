import Link from "next/link";
import type { ReactNode } from "react";

interface AppFooterProps {
  children: ReactNode;
}

export function AppFooter({ children }: AppFooterProps) {
  return (
    <footer className="border-border relative z-10 border-t bg-transparent">
      <div className="absolute top-0 right-0 left-0 h-px bg-gradient-to-r from-transparent via-[var(--sx-active-accent)] to-transparent opacity-20" />
      <div className="mx-auto flex max-w-[1520px] flex-col gap-3 px-4 py-4 sm:px-6 xl:px-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="sx-font-sans text-sm font-semibold text-[var(--sx-text)]">
              Scrutinix
            </span>
            <span className="hidden text-xs text-[var(--sx-text-soft)] sm:inline">
              Multi-signal URL triage
            </span>
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
          </div>

          <div className="min-w-0 flex-1 overflow-hidden text-xs text-[var(--sx-text-muted)] lg:text-right">
            {children}
          </div>
        </div>
      </div>
    </footer>
  );
}
