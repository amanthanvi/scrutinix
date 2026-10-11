import type { Metadata } from "next";

import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";
import { ScrutinixErrorBoundary } from "@/components/scrutinix/error-boundary";
import { HistorySection } from "@/components/scrutinix/history-section";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";
import {
  getSharedMetadata,
  resolveSharedView,
} from "@/lib/server/share-metadata";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function paramOf(
  params: Awaited<SearchParams>,
  name: "shared" | "sig",
): string | null {
  const value = params[name];
  return typeof value === "string" && value ? value : null;
}

/**
 * A shared result link Scrutinix signed previews as that result: its
 * title, instruction, and a per-result image (verdict, registered domain,
 * eight cells) for `SHARE_MAX_AGE` after the check. Anything unsigned or
 * older keeps the site defaults.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const params = await searchParams;
  return (
    getSharedMetadata(
      paramOf(params, "shared"),
      paramOf(params, "sig"),
      Date.now(),
    ) ?? {}
  );
}

export default async function HomePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  // Verified here, so the browser only ever receives a snapshot Scrutinix
  // signed. The Public Suffix List is already on the server too: the shared
  // link's anatomy goes down with it so a look-alike hedges from the first
  // paint.
  const shared = resolveSharedView(
    paramOf(params, "shared"),
    paramOf(params, "sig"),
    // A server component renders once per request and never re-renders on
    // the client: this is the request's clock, which the share's age is
    // judged against.
    // eslint-disable-next-line react-hooks/purity -- request time, see above
    Date.now(),
  );

  return (
    <AnalyzerRuntimeProvider shared={shared}>
      <div className="flex min-h-screen flex-col">
        <AppHeader />

        <main
          id="main-content"
          className="mx-auto w-full max-w-[46rem] flex-1 px-4 pt-12 sm:px-6 sm:pt-20"
        >
          <h1 className="sx-hero-title text-headline sm:text-display font-semibold text-balance text-[var(--sx-text)]">
            Check a link before you click.
          </h1>
          <p className="text-lead mt-3 max-w-[34rem] text-pretty text-[var(--sx-text-muted)]">
            Paste a link from an email, text, or chat. Eight independent checks
            tell you whether it&apos;s safe to open, and who really owns it.
          </p>

          <div className="sx-hero-form mt-8 sm:mt-10">
            <ScrutinixErrorBoundary>
              <div className="flex flex-col gap-10">
                <ScanForm />
                <ResultsSection />
              </div>
            </ScrutinixErrorBoundary>
          </div>

          {/* No gap when history is empty: its region draws nothing. */}
          <div className="mt-20 has-[>div[aria-busy]]:mt-0 has-[>section:empty]:mt-0">
            <ScrutinixErrorBoundary>
              <HistorySection />
            </ScrutinixErrorBoundary>
          </div>
        </main>

        <AppFooter />
      </div>
    </AnalyzerRuntimeProvider>
  );
}
