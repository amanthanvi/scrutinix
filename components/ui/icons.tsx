import type { ReactNode, SVGProps } from "react";

/*
 * The page's four icons, drawn as lucide-react 1.58 draws them: the same
 * attributes, classes, and paths, without the icon library's runtime in
 * the first load. Path data from Lucide (https://lucide.dev):
 *
 *   ISC License. Copyright (c) 2026 Lucide Icons and Contributors.
 *   Permission to use, copy, modify, and/or distribute this software for
 *   any purpose with or without fee is hereby granted, provided that the
 *   above copyright notice and this permission notice appear in all copies.
 *   THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL
 *   WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED
 *   WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR
 *   BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES
 *   OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
 *   WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
 *   ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS
 *   SOFTWARE.
 *
 * corner-down-left is derived from Feather (MIT License, Copyright (c)
 * 2013-present Cole Bemis), as Lucide's license notes.
 */

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function icon(name: string, paths: ReactNode) {
  function Icon({ className, ...props }: IconProps) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className ? `lucide ${name} ${className}` : `lucide ${name}`}
        aria-hidden="true"
        {...props}
      >
        {paths}
      </svg>
    );
  }
  return Icon;
}

export const MoonStar = icon(
  "lucide-moon-star",
  <>
    <path d="M18 5h4" />
    <path d="M20 3v4" />
    <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
  </>,
);

export const SunMedium = icon(
  "lucide-sun-medium",
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v1" />
    <path d="M12 20v1" />
    <path d="M3 12h1" />
    <path d="M20 12h1" />
    <path d="m18.364 5.636-.707.707" />
    <path d="m6.343 17.657-.707.707" />
    <path d="m5.636 5.636.707.707" />
    <path d="m17.657 17.657.707.707" />
  </>,
);

export const ClipboardPaste = icon(
  "lucide-clipboard-paste",
  <>
    <path d="M11 14h10" />
    <path d="M16 4h2a2 2 0 0 1 2 2v1.344" />
    <path d="m17 18 4-4-4-4" />
    <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113" />
    <rect x="8" y="2" width="8" height="4" rx="1" />
  </>,
);

export const CornerDownLeft = icon(
  "lucide-corner-down-left",
  <>
    <path d="M20 4v7a4 4 0 0 1-4 4H4" />
    <path d="m9 10-5 5 5 5" />
  </>,
);
