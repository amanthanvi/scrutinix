import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the custom type scale in app/globals.css
 * (`--text-*`); otherwise it reads `text-meta` as a colour and drops it
 * whenever a `text-[var(--sx-…)]` colour follows.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [
        "caption",
        "meta",
        "body",
        "lead",
        "title",
        "imperative",
        "headline",
        "display",
        "verdict-sm",
        "verdict",
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
