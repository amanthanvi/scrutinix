"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";

export function AppHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  const wordmark = (
    <span className="text-sm font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
      Scrutinix
    </span>
  );

  return (
    <header className="border-border border-b">
      <div className="mx-auto flex h-14 w-full max-w-[44rem] items-center justify-between px-4 sm:px-6">
        {isHome ? (
          wordmark
        ) : (
          <Link href="/" className="flex min-h-11 items-center rounded-md">
            {wordmark}
          </Link>
        )}

        <nav aria-label="Primary" className="flex items-center gap-1">
          {[
            { href: "/about", label: "About" },
            { href: "/privacy", label: "Privacy" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              className={`inline-flex min-h-11 items-center rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors ${
                pathname === href
                  ? "text-[var(--sx-text)]"
                  : "text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"
              }`}
              aria-current={pathname === href ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
