import {
  AnalyzerChrome,
  AnalyzerRuntimeProvider,
  AnalyzerWorkspace,
  FooterTicker,
  HistoryRail,
  ScanDock,
  ShellHeader,
} from "@/components/scrutinix/analyzer-app";
import { ScrutinixErrorBoundary } from "@/components/scrutinix/error-boundary";
import { IntroPanel } from "@/components/scrutinix/intro-panel";

export default function HomePage() {
  return (
    <AnalyzerRuntimeProvider>
      <AnalyzerChrome>
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

        <FooterTicker />
      </AnalyzerChrome>
    </AnalyzerRuntimeProvider>
  );
}
