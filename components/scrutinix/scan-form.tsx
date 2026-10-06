"use client";

import { toast } from "sonner";

import {
  type Tab,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { BatchInput, SingleInput } from "@/components/scrutinix/input-panels";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  downloadTextFile,
  resultsToCsv,
  resultsToJson,
} from "@/lib/client/export";

function StreamError({ message }: { message: string }) {
  return (
    <p className="mt-4 text-[0.8125rem] text-[var(--sx-malicious-fg)]">
      {message}
    </p>
  );
}

export function ScanForm() {
  const {
    active,
    activeTab,
    batch,
    batchInput,
    formError,
    inputEditedSinceResult,
    scan,
    setActiveTab,
    setBatchInput,
    setFormError,
    singleUrl,
    startBatchScan,
    startSingleScan,
    updateSingleUrl,
  } = useAnalyzerRuntime();

  return (
    <section id="scan-console" aria-label="Scan console">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as Tab);
          setFormError(null);
        }}
        className="gap-4"
      >
        <TabsList aria-label="Scan mode">
          <TabsTrigger value="single">Single</TabsTrigger>
          <TabsTrigger value="batch">Batch</TabsTrigger>
        </TabsList>

        <TabsContent value="single" className="mt-0">
          <SingleInput
            url={singleUrl}
            onUrlChange={(value) => {
              setFormError(null);
              updateSingleUrl(value);
            }}
            error={activeTab === "single" ? formError : null}
            streaming={scan.state.isStreaming}
            showingResult={Boolean(active) && !inputEditedSinceResult}
            onSubmit={() => void startSingleScan()}
            onCancel={scan.cancelScan}
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
              downloadTextFile("batch.csv", resultsToCsv(batch.state.results));
              toast.success("Downloaded batch.csv");
            }}
            onJson={() => {
              downloadTextFile(
                "batch.json",
                resultsToJson(batch.state.results),
                "application/json",
              );
              toast.success("Downloaded batch.json");
            }}
          />
        </TabsContent>
      </Tabs>

      {scan.state.error ? (
        <StreamError message={scan.state.error.message} />
      ) : null}
      {batch.state.error ? (
        <StreamError message={batch.state.error.message} />
      ) : null}
    </section>
  );
}
