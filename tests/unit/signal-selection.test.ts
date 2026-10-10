import { describe, expect, it } from "vitest";

import {
  describeQuietChecks,
  selectSummarySignals,
} from "@/components/shared/signal-selection";
import { getSignalSeverity } from "@/lib/domain/signal-severity";
import {
  createPendingSignalResults,
  signalNames,
  type SignalResults,
} from "@/lib/domain/types";
import { sanitizeHistoryEntry } from "@/lib/domain/runtime-safety";
import {
  buildThreatAssessment,
  getScoredSignals,
  withScoredSignals,
} from "@/lib/domain/verdict";
import {
  fixtureHosts,
  fixtureSignals,
} from "@/tests/fixtures/scenario-signals";
import {
  cleanSignals,
  withDomainAge,
  withLureRedirect,
} from "@/tests/fixtures/lure-signals";

describe("selectSummarySignals", () => {
  it("shows no rows and one plain line for a clean, complete scan", () => {
    const selection = selectSummarySignals(cleanSignals());

    expect(selection.drivers).toEqual([]);
    expect(describeQuietChecks(selection)).toBe("All 8 checks found nothing.");
  });

  it("shows only the signals that drove a Malicious verdict", () => {
    // The D6 bug: three slots filled by severity put two "No threat
    // matches" rows under a Malicious verdict.
    const signals = cleanSignals();
    if (signals.virusTotal.data) signals.virusTotal.data.malicious = 7;
    if (signals.threatFeeds.data) {
      signals.threatFeeds.data.matches = [
        {
          feed: "urlhaus",
          matchedUrl: "https://evil.example/",
          detail: "lists this link as a malware download",
          confidence: "high",
          matchType: "url",
        },
      ];
    }

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual(["threatFeeds", "virusTotal"]);
    expect(describeQuietChecks(selection)).toBe(
      "6 other checks found nothing.",
    );
  });

  it("keeps drivers in a fixed order and counts caveats separately", () => {
    const signals = cleanSignals();
    signals.dns = {
      status: "error",
      error: "DNS timed out.",
      data: null,
      durationMs: 2_000,
    };
    if (signals.whois.data) signals.whois.data.ageDays = 3;
    signals.ssl = {
      status: "skipped",
      error: "No TLS for this target.",
      data: null,
      durationMs: 0,
    };

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual(["whois", "dns"]);
    expect(describeQuietChecks(selection)).toBe(
      "5 other checks found nothing and 1 couldn't give a full answer.",
    );
  });

  it("counts checks still running while a scan streams", () => {
    const signals = createPendingSignalResults();
    signals.virusTotal = cleanSignals().virusTotal;

    const selection = selectSummarySignals(signals);

    expect(selection.drivers).toEqual([]);
    expect(describeQuietChecks(selection)).toBe(
      "1 check found nothing and 7 are still running.",
    );
  });

  it("uses singular agreement for one running check", () => {
    const signals = cleanSignals();
    signals.dns = createPendingSignalResults().dns;

    expect(describeQuietChecks(selectSummarySignals(signals))).toBe(
      "7 checks found nothing and 1 is still running.",
    );
  });
});

/** The selection the live view computes for a finished scan. */
function finishedSelection(signals: SignalResults) {
  const { threatInfo } = buildThreatAssessment(signals);
  return selectSummarySignals(signals, threatInfo?.scoredSignals);
}

describe("Summary drivers follow the verdict engine", () => {
  it("shows the redirect and domain-age checks that made a link Suspicious", () => {
    // The review bug: per-signal thresholds called these "clear", so a
    // Suspicious verdict showed no rows and "All 8 checks found nothing."
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);

    expect(buildThreatAssessment(signals).verdict).toBe("suspicious");
    const selection = finishedSelection(signals);

    expect(selection.drivers).toEqual(["redirectChain", "whois"]);
    expect(describeQuietChecks(selection)).toBe(
      "6 other checks found nothing.",
    );
  });

  it("keeps the drivers with or without a cross-site password form", () => {
    for (const passwordForm of [false, true]) {
      const signals = cleanSignals();
      withLureRedirect(signals, { passwordForm });
      withDomainAge(signals, 90);

      const selection = finishedSelection(signals);
      expect(selection.drivers).toEqual(["redirectChain", "whois"]);
      expect(describeQuietChecks(selection)).toBe(
        "6 other checks found nothing.",
      );
    }
  });

  it("lists a minor warning sign under a Safe verdict", () => {
    const signals = cleanSignals();
    withDomainAge(signals, 100);

    const { verdict, threatInfo } = buildThreatAssessment(signals);
    expect(verdict).toBe("safe");
    expect(threatInfo?.hasPositiveEvidence).toBe(true);
    expect(finishedSelection(signals).drivers).toEqual(["whois"]);
  });

  it("never shows a scored check with the gray found-nothing dot", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);

    const scored = getScoredSignals(signals);
    expect([...scored].sort()).toEqual(["redirectChain", "whois"]);
    for (const name of scored) {
      const signal = signals[name];
      expect(
        getSignalSeverity(signal.status, signal.data, name, true),
      ).not.toBe("clear");
    }
  });

  it("falls back to severity alone while a scan streams", () => {
    const signals = cleanSignals();
    withDomainAge(signals, 100);

    // No verdict yet: 100 days is below the row's own warning threshold.
    expect(selectSummarySignals(signals).drivers).toEqual([]);
  });

  it("shows a driver whenever the verdict found something", async () => {
    const scenarios: SignalResults[] = [];
    for (const host of fixtureHosts) {
      scenarios.push(await fixtureSignals(host));
    }
    const lure = cleanSignals();
    withLureRedirect(lure, { hiddenIframe: true, passwordForm: true });
    withDomainAge(lure, 12);
    scenarios.push(lure);
    const young = cleanSignals();
    withDomainAge(young, 20);
    scenarios.push(young);

    for (const signals of scenarios) {
      const { verdict, threatInfo } = buildThreatAssessment(signals);
      const selection = selectSummarySignals(
        signals,
        threatInfo?.scoredSignals,
      );

      for (const name of getScoredSignals(signals)) {
        expect(selection.drivers).toContain(name);
      }
      if (
        (verdict !== "safe" && verdict !== "unknown") ||
        threatInfo?.hasPositiveEvidence
      ) {
        expect(selection.drivers.length).toBeGreaterThan(0);
        expect(describeQuietChecks(selection)).not.toMatch(/^All \d+ checks/);
      }
    }
  });

  it("matches the stored scored list to the engine for every signal", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    const { threatInfo } = buildThreatAssessment(signals);
    const scored = getScoredSignals(signals);

    expect(threatInfo?.scoredSignals).toEqual(
      signalNames.filter((name) => scored.has(name)),
    );
  });
});

/** A result as history stored it before `scoredSignals` existed. */
function legacyHistoryEntry(signals: SignalResults) {
  const { verdict, threatInfo } = buildThreatAssessment(signals);
  const legacyThreatInfo: Record<string, unknown> = { ...threatInfo };
  delete legacyThreatInfo.scoredSignals;
  const entry = sanitizeHistoryEntry({
    id: "legacy",
    url: "https://short.example/a",
    verdict,
    signals,
    threatInfo: legacyThreatInfo,
    metadata: {
      scanId: "legacy",
      startedAt: "2026-09-01T00:00:00.000Z",
      completedAt: "2026-09-01T00:00:01.000Z",
      cacheHit: false,
      partialFailure: false,
      signalCount: 8,
      durationMs: 1_000,
    },
    savedAt: "2026-09-01T00:00:01.000Z",
  });
  if (!entry) throw new Error("legacy entry failed to sanitize");
  return entry;
}

describe("withScoredSignals (history saved before scoredSignals)", () => {
  it("re-derives the drivers so Summary shows the evidence", () => {
    const signals = cleanSignals();
    withLureRedirect(signals, { hiddenIframe: true });
    withDomainAge(signals, 100);
    const legacy = legacyHistoryEntry(signals);
    expect(legacy.threatInfo?.scoredSignals).toBeUndefined();

    const entry = withScoredSignals(legacy);

    // Signal order, exactly as a fresh scan stores it.
    expect(entry.threatInfo?.scoredSignals).toEqual(
      buildThreatAssessment(signals).threatInfo?.scoredSignals,
    );
    expect(entry.threatInfo?.scoredSignals).toEqual(["whois", "redirectChain"]);
    // Stored verdict, score, and copy stay exactly as saved.
    expect(entry.verdict).toBe(legacy.verdict);
    expect(entry.threatInfo?.score).toBe(legacy.threatInfo?.score);
    expect(entry.threatInfo?.summary).toBe(legacy.threatInfo?.summary);
    const selection = selectSummarySignals(
      entry.signals,
      entry.threatInfo?.scoredSignals,
    );
    expect(selection.drivers).toEqual(["redirectChain", "whois"]);
    expect(describeQuietChecks(selection)).toBe(
      "6 other checks found nothing.",
    );
  });

  it("keeps an explicit empty list and results without threat info", () => {
    const safe = cleanSignals();
    const { verdict, threatInfo } = buildThreatAssessment(safe);
    expect(threatInfo?.scoredSignals).toEqual([]);
    const stored = { ...legacyHistoryEntry(safe), verdict, threatInfo };
    // Even if the engine would now score something, a stored [] stands.
    withDomainAge(stored.signals, 100);
    expect(withScoredSignals(stored)).toBe(stored);

    const failed = { ...stored, threatInfo: null };
    expect(withScoredSignals(failed)).toBe(failed);
  });
});
