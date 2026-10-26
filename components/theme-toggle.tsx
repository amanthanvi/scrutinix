"use client";

import { useSyncExternalStore } from "react";
import { MoonStar, SunMedium } from "@/components/ui/icons";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const isDark = resolvedTheme !== "light";
  const label = !mounted
    ? "Toggle theme"
    : isDark
      ? "Switch to light theme"
      : "Switch to dark theme";

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={mounted ? () => setTheme(isDark ? "light" : "dark") : undefined}
      aria-label={label}
      className="relative rounded-md"
    >
      {/* The tooltip, over the whole button and hidden from assistive
          technology: a title on the button was read again after its name. */}
      <span aria-hidden="true" title={label} className="absolute inset-0" />
      {!mounted ? (
        <MoonStar className="h-4 w-4" />
      ) : isDark ? (
        <SunMedium className="h-4 w-4" />
      ) : (
        <MoonStar className="h-4 w-4" />
      )}
    </Button>
  );
}
