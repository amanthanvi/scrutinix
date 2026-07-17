import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";

import "@/app/globals.css";
import "@/app/scrutinix.css";
import { ThemeProvider } from "@/components/theme-provider";
import { AppToaster } from "@/components/ui/sonner";
import { getSiteUrl } from "@/lib/site-url";

const siteUrl = getSiteUrl();

const hack = localFont({
  src: [
    {
      path: "../public/fonts/hack-regular.woff2",
      weight: "400",
      style: "normal",
    },
  ],
  variable: "--font-hack",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Scrutinix — Multi-Signal URL Threat Analyzer",
  description:
    "Inspect suspicious links with streamed evidence from browser-protection lists, threat feeds, redirects, DNS, TLS, and ML scoring.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
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
    title: "Scrutinix — Multi-Signal URL Threat Analyzer",
    description:
      "Streamed, evidence-first URL threat analysis for suspicious links.",
    url: siteUrl,
    siteName: "Scrutinix",
    images: ["/opengraph-image"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scrutinix — Multi-Signal URL Threat Analyzer",
    description:
      "Streamed, evidence-first URL threat analysis for suspicious links.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
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
      <body
        className={`${GeistSans.variable} ${hack.variable} font-sans antialiased`}
      >
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
          <AppToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
