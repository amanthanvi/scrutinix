"use client";

import { toast } from "sonner";

import {
  type Tab,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { HeaderMetrics } from "@/components/scrutinix/header-metrics";
import { BatchInput, SingleInput } from "@/components/scrutinix/input-panels";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadTextFile,
  resultsToCsv,
  resultsToJson,
} from "@/lib/client/export";

export function ScanDock() {
  const {
    active,
    activeTab,
    batch,
    batchInput,
    formError,
    live,
    rescanUrl,
    scan,
    setActiveTab,
    setBatchInput,
    setFormError,
    setSingleUrl,
    shareResult,
    singleUrl,
    startBatchScan,
    startSingleScan,
  } = useAnalyzerRuntime();

  return (
    <section
      id="scan-console"
      className="sx-panel border-border flex flex-col overflow-hidden rounded-lg border"
      aria-labelledby="scan-dock-heading"
    >
      <div className="flex flex-col p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="sx-folio-stamp">Intake</p>
            <h2
              id="scan-dock-heading"
              className="text-xl font-semibold tracking-[-0.02em] text-[var(--sx-text)]"
            >
              Scan one link or a short batch.
            </h2>
            <p className="max-w-xl text-sm leading-6 text-[var(--sx-text-muted)]">
              Results stream into the workspace below as providers resolve.
            </p>
          </div>

          <Badge
            variant={
              live
                ? "active"
                : active
                  ? "safe"
                  : activeTab === "batch"
                    ? "neutral"
                    : "safe"
            }
          >
            {live ? "Live stream" : active ? "Result ready" : "Ready"}
          </Badge>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as Tab);
            setFormError(null);
          }}
          className="mt-7 gap-4"
        >
          <TabsList
            aria-label="Scan mode"
            className="w-full justify-start sm:w-fit"
          >
            <TabsTrigger value="single">Single Scan</TabsTrigger>
            <TabsTrigger value="batch">Batch Scan</TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="mt-0">
            <SingleInput
              url={singleUrl}
              onUrlChange={(value) => {
                setFormError(null);
                setSingleUrl(value);
              }}
              error={activeTab === "single" ? formError : null}
              streaming={scan.state.isStreaming}
              onSubmit={() => void startSingleScan()}
              onCancel={scan.cancelScan}
              result={active}
              onExport={() => {
                if (!active) return;
                downloadTextFile(
                  "scan.json",
                  JSON.stringify(active, null, 2),
                  "application/json",
                );
                toast.success("Exported scan.json");
              }}
              onShare={() => active && void shareResult(active)}
              onRescan={() => active && void rescanUrl(active.url)}
            />
          </TabsContent>

          <TabsContent value="batch" className="mt-0">
            <BatchInput
              value={batchInput}
              onChange={(value) => {
                setFormError(null);
                setBatchInput(value);
              }}
              error={activeTab === "batch" ? formError : null}
              streaming={batch.state.isStreaming}
              onSubmit={() => void startBatchScan()}
              onCancel={batch.cancelBatch}
              hasResults={batch.state.results.length > 0}
              onCsv={() => {
                downloadTextFile(
                  "batch.csv",
                  resultsToCsv(batch.state.results),
                );
                toast.success("Exported batch.csv");
              }}
              onJson={() => {
                downloadTextFile(
                  "batch.json",
                  resultsToJson(batch.state.results),
                  "application/json",
                );
                toast.success("Exported batch.json");
              }}
            />
          </TabsContent>
        </Tabs>

        {scan.state.error && (
          <div className="mt-4 rounded-lg border border-[var(--sx-malicious)] bg-[color-mix(in_srgb,var(--sx-malicious)_8%,transparent)] px-4 py-3 text-xs text-[var(--sx-malicious)]">
            {scan.state.error.message}
          </div>
        )}
        {batch.state.error && (
          <div className="mt-4 rounded-lg border border-[var(--sx-malicious)] bg-[color-mix(in_srgb,var(--sx-malicious)_8%,transparent)] px-4 py-3 text-xs text-[var(--sx-malicious)]">
            {batch.state.error.message}
          </div>
        )}
      </div>

      <footer className="border-border mt-auto border-t bg-[color-mix(in_srgb,var(--sx-border-muted)_12%,transparent)] px-6 py-4 sm:px-8">
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-2 text-[0.68rem] text-[var(--sx-text-soft)]">
          <span>8 live signals</span>
          <span>NDJSON stream</span>
          <span>Browser-only history</span>
        </div>
        <HeaderMetrics />
      </footer>
    </section>
  );
}
