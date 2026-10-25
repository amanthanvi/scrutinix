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
    <p role="alert" className="text-meta mt-4 text-[var(--sx-danger-fg)]">
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
    shared,
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
        className="gap-5"
      >
        <TabsList aria-label="Scan mode">
          <TabsTrigger value="single">Single</TabsTrigger>
          {/* The hint says what Batch is without joining the tab's name. */}
          <TabsTrigger value="batch" aria-describedby="sx-batch-tab-hint">
            Batch
            <span
              id="sx-batch-tab-hint"
              aria-hidden="true"
              className="ml-1.5 font-normal text-[var(--sx-text-soft)]"
            >
              up to 10 links
            </span>
          </TabsTrigger>
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
            // A shared link's band (verified or not) counts as a result on
            // screen: its scan button ("Run a fresh scan", or "Scan this
            // link" when unverified) is then the one primary action.
            showingResult={
              (Boolean(active) ||
                (Boolean(shared) && !scan.state.isStreaming)) &&
              !inputEditedSinceResult
            }
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
