import Link from "next/link";
import type { ReactNode } from "react";

interface AppFooterProps {
  children?: ReactNode;
}

export function AppFooter({ children }: AppFooterProps) {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto flex w-full max-w-[44rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-6 text-[0.8125rem] text-[var(--sx-text-muted)] sm:px-6">
        <span className="font-medium text-[var(--sx-text)]">Scrutinix</span>
        <nav aria-label="Footer" className="flex items-center gap-x-4">
          <Link
            href="/about"
            className="transition-colors hover:text-[var(--sx-text)]"
          >
            About
          </Link>
          <Link
            href="/privacy"
            className="transition-colors hover:text-[var(--sx-text)]"
          >
            Privacy
          </Link>
        </nav>
        <span className="ml-auto">
          {children ?? "History stays on this device"}
        </span>
      </div>
    </footer>
  );
}
