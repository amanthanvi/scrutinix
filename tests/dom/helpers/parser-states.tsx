import { render, screen } from "@testing-library/react";

import {
  AnalyzerRuntimeProvider,
  useAnalyzerRuntime,
} from "@/components/scrutinix/analyzer-runtime";
import { ResultsSection } from "@/components/scrutinix/results-section";
import {
  createPendingSignalResults,
  signalNames,
  type AnalysisResult,
  type Verdict,
} from "@/lib/domain/types";

/**
 * Results for the link-parser state tests. Built by hand, not with the
 * verdict engine: the engine imports tldts statically, and these files mock
 * tldts to hold or fail the browser's lazy import.
 */
export function storedResult(
  verdict: Extract<Verdict, "safe" | "malicious">,
  url: string,
): AnalysisResult {
  const signals = createPendingSignalResults();
  for (const name of signalNames) {
    signals[name] = {
      status: "skipped",
      data: null,
      error: "Not applicable in this test.",
      durationMs: 1,
    };
  }
  const malicious = verdict === "malicious";
  return {
    id: `${verdict}-${url}`,
    url,
    verdict,
    signals,
    threatInfo: {
      verdict,
      confidence: 0.9,
      confidenceLabel: "high",
      confidenceReasons: ["Every reputation source answered."],
      hasPositiveEvidence: malicious,
      scoredSignals: malicious ? ["virusTotal"] : [],
      score: malicious ? 73 : 4,
      summary: malicious
        ? "7 VirusTotal engines flagged this link."
        : "No check flagged this link.",
      categories: [],
      reasons: [],
      recommendations: [],
      limitations: [],
    },
    metadata: {
      scanId: `${verdict}-scan`,
      startedAt: "2026-10-06T00:00:00.000Z",
      completedAt: "2026-10-06T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
  };
}

/**
 * What a reassuring Safe band says: the word, its instruction, or a
 * confidence line ("Google Safe Browsing" in a caveat is a check's name).
 */
export const VERDICT_SAFE = /\bSafe\b(?! Browsing)|confidence|Looks safe/;

export const LOOK_ALIKE_URL = "https://paypal.com.safe.scrutinix.test/";

function OpenStored({ results }: { results: AnalysisResult[] }) {
  const { openStoredResult } = useAnalyzerRuntime();
  return (
    <>
      {results.map((result) => (
        <button
          key={result.id}
          type="button"
          onClick={() => openStoredResult(result)}
        >
          open {result.url}
        </button>
      ))}
    </>
  );
}

export function renderResults(results: AnalysisResult[]) {
  return render(
    <AnalyzerRuntimeProvider shared={null}>
      <ResultsSection />
      <OpenStored results={results} />
    </AnalyzerRuntimeProvider>,
  );
}

export function liveRegion(): string {
  return document.querySelector("[aria-live='polite']")?.textContent ?? "";
}

/** The band: a `section` named for its state. */
export function band(): HTMLElement {
  return screen.getByLabelText(/^(scan result: |checking the link)/i, {
    selector: "section",
  });
}

/**
 * Every verdict word the band's heading shows, in order, from now on: a
 * transient "Safe" between two renders is caught, not just the end state.
 */
export function recordHeadings(): { words: string[]; stop: () => void } {
  const words: string[] = [];
  const read = () => {
    const text = document.getElementById("sx-verdict-heading")?.textContent;
    if (text && words.at(-1) !== text) words.push(text);
  };
  const observer = new MutationObserver(read);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  read();
  return { words, stop: () => observer.disconnect() };
}
