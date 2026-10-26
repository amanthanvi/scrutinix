"use client";

import { useSyncExternalStore } from "react";
import { MoonStar, SunMedium } from "lucide-react";
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
      // The title is the icon's name and its hover tooltip at once. With
      // an aria-label too, it was read again as a description.
      title={label}
      className="rounded-md"
    >
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
