"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { BrandMark } from "@/components/scrutinix/signal-cell";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
] as const;

export function AppHeader() {
  const pathname = usePathname();
  const isHome = pathname === "/";

  const wordmark = (
    <span className="flex items-center gap-[0.5625rem] font-serif text-[1.3125rem] leading-none font-semibold tracking-[-0.012em] text-[var(--sx-text)] sm:gap-[0.6875rem] sm:text-[1.4375rem]">
      <BrandMark className="mt-px h-[0.5625rem] w-auto sm:h-2.5" />
      Scrutinix
    </span>
  );

  return (
    <header className="border-b border-[var(--sx-border)]">
      <div className="mx-auto flex h-[3.75rem] w-full max-w-[71rem] items-center justify-between px-4 sm:h-[4.5rem] sm:px-6">
        {isHome ? (
          wordmark
        ) : (
          <Link
            href="/"
            aria-label="Scrutinix home"
            className="-mx-1.5 flex min-h-11 items-center rounded-md px-1.5"
          >
            {wordmark}
          </Link>
        )}

        <nav aria-label="Primary" className="-mr-2 flex items-center gap-0.5">
          {NAV.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className={cn(
                "text-meta inline-flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 font-medium transition-colors sm:px-3",
                pathname === href
                  ? "text-[var(--sx-text)]"
                  : "text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]",
              )}
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
