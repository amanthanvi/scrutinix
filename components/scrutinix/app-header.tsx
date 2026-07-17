"use client";

import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "@/components/theme-toggle";

interface AppHeaderProps {
  children?: ReactNode;
  /** 0–100 threat score for the accent bar. Omit or 0 to hide. */
  threatScore?: number;
  /** CSS color value for the threat bar, e.g. "var(--sx-safe)" */
  scoreColor?: string;
  /** Whether a scan has been started (hides bar when false) */
  hasActivity?: boolean;
}

export function AppHeader({
  children,
  threatScore = 0,
  scoreColor,
  hasActivity = false,
}: AppHeaderProps) {
  const pathname = usePathname();
  const isHome = pathname === "/";

  const brand = (
    <>
      <span className="border-border bg-card relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg border">
        <Image
          src="/favicon.ico"
          alt=""
          width={36}
          height={36}
          className="h-[1.35rem] w-[1.35rem] object-contain"
          priority
        />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="sx-font-sans text-sm font-semibold text-[var(--sx-text)]">
          Scrutinix
        </span>
        <span className="sx-font-sans text-xs text-[var(--sx-text-muted)]">
          Public threat analysis
        </span>
      </span>
    </>
  );

  return (
    <header className="border-border bg-background/90 relative z-20 border-b backdrop-blur">
      <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-4 px-4 py-4 sm:px-6 xl:px-8">
        <div className="flex min-w-0 items-center gap-4">
          {isHome ? (
            <div
              className="flex items-center gap-3 rounded-md text-left"
              aria-label="Scrutinix"
            >
              {brand}
            </div>
          ) : (
            <Link
              href="/"
              className="sx-btn-press flex items-center gap-3 rounded-md text-left"
            >
              {brand}
            </Link>
          )}

          <nav
            aria-label="Primary"
            className="hidden items-center gap-1 md:flex"
          >
            {[
              { href: "/", label: "Scanner" },
              { href: "/about", label: "Method" },
              { href: "/privacy", label: "Privacy" },
            ].map(({ href, label }) => {
              const active = href === "/" ? isHome : pathname === href;
              return (
                <Link
                  key={href}
                  href={href}
                  className={`sx-btn-press flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors ${active ? "text-[var(--sx-text)]" : "hover:bg-muted text-[var(--sx-text-muted)] hover:text-[var(--sx-text)]"}`}
                >
                  {label}
                  {active ? (
                    <span
                      className="sx-led"
                      style={{
                        width: 6,
                        height: 6,
                        backgroundColor: hasActivity
                          ? "var(--sx-active-accent)"
                          : "var(--sx-border-muted)",
                      }}
                    />
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="ml-auto flex flex-1 items-center justify-end gap-3">
          {children ? (
            <div className="hidden min-w-0 flex-1 justify-end lg:flex">
              {children}
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Threat bar — thin accent line that fills with score */}
      <div
        className="absolute bottom-0 left-0 h-[2px] transition-[width,background-color,opacity] duration-500 ease-out"
        style={{
          width: hasActivity
            ? `${Math.min(Math.max(threatScore, 0), 100)}%`
            : "0%",
          backgroundColor: scoreColor ?? "var(--sx-active-accent)",
          opacity: hasActivity ? 1 : 0,
        }}
      />
    </header>
  );
}
