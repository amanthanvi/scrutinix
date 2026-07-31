import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { AnalyzerWorkspace } from "@/components/scrutinix/analyzer-workspace";
import { AppFooter } from "@/components/scrutinix/app-footer";
import { AppHeader } from "@/components/scrutinix/app-header";
import { ScrutinixErrorBoundary } from "@/components/scrutinix/error-boundary";
import { HistoryRail } from "@/components/scrutinix/history-rail";
import { ScanDock } from "@/components/scrutinix/scan-dock";

export default function HomePage() {
  return (
    <AnalyzerRuntimeProvider>
      <div className="flex min-h-screen flex-col">
        <AppHeader />

        <main
          id="main-content"
          className="mx-auto w-full max-w-[44rem] flex-1 px-4 pt-10 pb-16 sm:px-6"
        >
          <h1 className="text-xl font-semibold tracking-[-0.01em] text-[var(--sx-text)]">
            Check a link before you click.
          </h1>
          <p className="mt-1.5 text-sm text-[var(--sx-text-muted)]">
            Eight security signals stream into one verdict. Scans stay on this
            device.
          </p>

          <div className="mt-8 flex flex-col gap-10">
            <ScrutinixErrorBoundary>
              <div className="flex flex-col gap-6">
                <ScanDock />
                <AnalyzerWorkspace />
              </div>
            </ScrutinixErrorBoundary>

            <ScrutinixErrorBoundary>
              <HistoryRail />
            </ScrutinixErrorBoundary>
          </div>
        </main>

        <AppFooter />
      </div>
    </AnalyzerRuntimeProvider>
  );
}
