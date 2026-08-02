"use client";

import { useState } from "react";
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
  const { prefill } = useAnalyzerRuntime();

  return (
    <ScanDockContent
      key={prefill?.nonce ?? "initial"}
      initialSingleUrl={prefill?.url ?? ""}
    />
  );
}

function ScanDockContent({ initialSingleUrl }: { initialSingleUrl: string }) {
  const {
    active,
    activeTab,
    batch,
    formError,
    live,
    rescanUrl,
    scan,
    setActiveTab,
    setFormError,
    shareResult,
    submitBatch,
    submitSingle,
  } = useAnalyzerRuntime();

  // Input text lives here, not in the shared context: typing must not
  // re-render the whole analyzer tree. The runtime pushes URLs back in via
  // prefill (re-scan, history selection). ScanDock remounts this local input
  // island when the prefill nonce changes, avoiding shared-context keystrokes.
  const [singleUrl, setSingleUrl] = useState(initialSingleUrl);
  const [batchInput, setBatchInput] = useState("");

  return (
    <section
      id="scan-console"
      className="sx-panel border-border flex flex-col overflow-hidden rounded-lg border"
      aria-labelledby="scan-dock-heading"
    >
      <div className="flex flex-col p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2
            id="scan-dock-heading"
            className="text-2xl font-semibold tracking-[-0.02em] text-[var(--sx-text)]"
          >
            Scan
          </h2>

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
          className="mt-4 gap-4"
        >
          <TabsList
            aria-label="Scan mode"
            className="w-full justify-start sm:w-fit"
          >
            <TabsTrigger value="single">Single</TabsTrigger>
            <TabsTrigger value="batch">Batch</TabsTrigger>
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
              onSubmit={() => void submitSingle(singleUrl)}
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
              onSubmit={() => void submitBatch(batchInput)}
              onCancel={batch.cancelBatch}
              hasResults={batch.state.results.length > 0}
              onCsv={() => {
                downloadTextFile(
                  "batch.csv",
                  resultsToCsv(batch.state.results),
                  "text/csv",
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
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--sx-malicious)] bg-[color-mix(in_srgb,var(--sx-malicious)_8%,transparent)] px-4 py-3 text-xs text-[var(--sx-malicious)]"
          >
            {scan.state.error.message}
          </div>
        )}
        {batch.state.error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-[var(--sx-malicious)] bg-[color-mix(in_srgb,var(--sx-malicious)_8%,transparent)] px-4 py-3 text-xs text-[var(--sx-malicious)]"
          >
            {batch.state.error.message}
          </div>
        )}
      </div>

      <footer className="border-border mt-auto border-t bg-[color-mix(in_srgb,var(--sx-border-muted)_10%,transparent)] px-5 py-4 sm:px-6">
        <HeaderMetrics />
      </footer>
    </section>
  );
}
