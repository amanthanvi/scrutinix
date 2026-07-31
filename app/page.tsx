import { AnalyzerRuntimeProvider } from "@/components/scrutinix/analyzer-runtime";
import { AnalyzerWorkspace } from "@/components/scrutinix/analyzer-workspace";
import { ScrutinixErrorBoundary } from "@/components/scrutinix/error-boundary";
import { ShellHeader } from "@/components/scrutinix/header-metrics";
import { HistoryRail } from "@/components/scrutinix/history-rail";
import { IntroPanel } from "@/components/scrutinix/intro-panel";
import { ScanDock } from "@/components/scrutinix/scan-dock";

export default function HomePage() {
  return (
    <AnalyzerRuntimeProvider>
      <div className="relative flex min-h-screen flex-col">
        <ShellHeader />

        <main id="main-content" className="relative z-10 flex-1 pb-10">
          <IntroPanel dock={<ScanDock />} />

          <div className="mx-auto flex max-w-[1520px] flex-col gap-12 px-4 pt-10 sm:px-6 xl:px-8">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
              <ScrutinixErrorBoundary>
                <AnalyzerWorkspace />
              </ScrutinixErrorBoundary>

              <ScrutinixErrorBoundary>
                <div className="xl:sticky xl:top-6">
                  <HistoryRail />
                </div>
              </ScrutinixErrorBoundary>
            </div>
          </div>
        </main>
      </div>
    </AnalyzerRuntimeProvider>
  );
}
