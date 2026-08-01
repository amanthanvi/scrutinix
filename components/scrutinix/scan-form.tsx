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
    <div className="mt-4 rounded-md border border-[var(--sx-malicious)] px-3 py-2.5 text-[0.8125rem] text-[var(--sx-malicious-fg)]">
      {message}
    </div>
  );
}

export function ScanForm() {
  const {
    activeTab,
    batch,
    batchInput,
    formError,
    scan,
    setActiveTab,
    setBatchInput,
    setFormError,
    setSingleUrl,
    singleUrl,
    startBatchScan,
    startSingleScan,
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
              setSingleUrl(value);
            }}
            error={activeTab === "single" ? formError : null}
            streaming={scan.state.isStreaming}
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

      {scan.state.error ? (
        <StreamError message={scan.state.error.message} />
      ) : null}
      {batch.state.error ? (
        <StreamError message={batch.state.error.message} />
      ) : null}
    </section>
  );
}
