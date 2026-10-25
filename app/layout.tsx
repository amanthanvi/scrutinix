import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";

import "@/app/globals.css";
import "@/app/scrutinix.css";
import { ThemeProvider } from "@/components/theme-provider";
import { LazyToaster } from "@/components/ui/lazy-toaster";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Scrutinix — Check a link before you click",
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
  openGraph: {
    title: "Scrutinix — Check a link before you click",
    description:
      "Check a link before you click. Eight separate checks, one plain verdict.",
    url: siteUrl,
    siteName: "Scrutinix",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scrutinix — Check a link before you click",
    description:
      "Check a link before you click. Eight separate checks, one plain verdict.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c0e12" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
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
    <html lang="en" suppressHydrationWarning>
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
          <LazyToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
