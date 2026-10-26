import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";

import "@/app/globals.css";
import "@/app/scrutinix.css";
import { ThemeProvider } from "@/components/theme-provider";
import { Announcer } from "@/components/ui/announcer";
import { LazyToaster } from "@/components/ui/lazy-toaster";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();

/**
 * The one display face: Newsreader (SIL OFL 1.1), two static latin cuts
 * built by `scripts/build-display-fonts.sh` (400 at opsz 16 for reading
 * size, 600 at opsz 60 for display). Self-hosted and preloaded as CSS, no
 * runtime script; `--font-display` in app/globals.css reads the variable.
 * Interface text stays the system sans, links and data the system mono.
 */
const newsreader = localFont({
  src: [
    {
      path: "../fonts/newsreader/newsreader-400-opsz16.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../fonts/newsreader/newsreader-600-opsz60.woff2",
      weight: "600",
      style: "normal",
    },
  ],
  variable: "--font-newsreader",
  display: "swap",
  fallback: ["Georgia", "Times New Roman", "serif"],
  adjustFontFallback: "Times New Roman",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Scrutinix — Is this link what it says it is?",
  description:
    "Paste a link from an email, text, or chat. Eight separate checks tell you whether it's safe to open, and which site it really belongs to.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
  manifest: "/site.webmanifest",
  // No `images` here: app/opengraph-image.tsx supplies the default card on
  // every page (hashed URL, alt, size), and Next copies it to twitter:image.
  // Setting `images` would replace it with a bare URL and no alt text.
  openGraph: {
    title: "Scrutinix — Is this link what it says it is?",
    description: "Eight separate checks, one plain verdict.",
    url: siteUrl,
    siteName: "Scrutinix",
  },
  twitter: {
    card: "summary_large_image",
    title: "Scrutinix — Is this link what it says it is?",
    description: "Eight separate checks, one plain verdict.",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0e1012" },
    { media: "(prefers-color-scheme: light)", color: "#fafcfe" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Reading headers forces dynamic render so Next can apply the proxy nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={newsreader.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <a href="#main-content" className="sx-skip-link">
          Skip to content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <div className="scrutinix-theme">{children}</div>
          <Announcer />
          <LazyToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
