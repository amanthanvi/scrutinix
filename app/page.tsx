import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";
import { ScrutinixErrorBoundary } from "@/components/scrutinix/error-boundary";
import { HistorySection } from "@/components/scrutinix/history-section";
import { ResultsSection } from "@/components/scrutinix/results-section";
import { ScanForm } from "@/components/scrutinix/scan-form";

export default function HomePage() {
  return (
    <AnalyzerRuntimeProvider>
      <div className="flex min-h-screen flex-col">
        <AppHeader />

        <main
          id="main-content"
          className="mx-auto w-full max-w-[44rem] flex-1 px-4 pt-12 pb-16 sm:px-6"
        >
          <h1 className="sr-only">Scrutinix — URL threat scanner</h1>
          <p className="text-sm text-[var(--sx-text-muted)]">
            Check a link against eight security signals before you open it.
          </p>

          <div className="mt-8 flex flex-col gap-12">
            <ScrutinixErrorBoundary>
              <div className="flex flex-col gap-8">
                <ScanForm />
                <ResultsSection />
              </div>
            </ScrutinixErrorBoundary>

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
