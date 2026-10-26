import { signalNames, type SignalResults } from "@/lib/domain/types";
import { normalizeUrlInput } from "@/lib/domain/url";
import { getFixtureSignalProviders } from "@/lib/server/test-fixtures";

/** The offline e2e fixture hosts, as finished SignalResults. */
export const fixtureHosts = [
  "example.com",
  "malicious.scrutinix.test",
  "feed-hit.scrutinix.test",
  "unreachable.scrutinix.test",
] as const;

export async function fixtureSignals(host: string): Promise<SignalResults> {
  const target = normalizeUrlInput(`https://${host}/`);
  if (!target.ok) {
    throw new Error(`Bad fixture host: ${host}`);
  }

  const previous = process.env.SCRUTINIX_TEST_FIXTURES;
  process.env.SCRUTINIX_TEST_FIXTURES = "1";
  try {
    const providers = getFixtureSignalProviders(target.value);
    if (!providers) {
      throw new Error("Fixture providers are disabled.");
    }

    const results = {} as Record<string, unknown>;
    for (const name of signalNames) {
      results[name] = {
        status: "success",
        error: null,
        durationMs: 5,
        data: await providers[name](),
      };
    }
    return results as SignalResults;
  } finally {
    if (previous === undefined) {
      delete process.env.SCRUTINIX_TEST_FIXTURES;
    } else {
      process.env.SCRUTINIX_TEST_FIXTURES = previous;
    }
  }
}

/** Critical from local heuristics alone: no reputation source objected. */
export async function heuristicCriticalSignals(): Promise<SignalResults> {
  const signals = await fixtureSignals("example.com");
  const ml = signals.mlEnsemble.data;
  if (ml) {
    ml.consensusLabel = "malicious";
    ml.consensusScore = 0.98;
    ml.reasons = ["The link imitates a bank sign-in page."];
  }
  if (signals.whois.data) signals.whois.data.ageDays = 3;
  if (signals.ssl.data) {
    signals.ssl.data.validationState = "invalid";
    signals.ssl.data.validFrom = new Date(
      Date.now() - 86_400_000,
    ).toISOString();
  }
  if (signals.dns.data) {
    signals.dns.data.anomalies = [
      "The hostname uses punycode, which can hide a look-alike name.",
      "No mail records exist for a domain that asks for logins.",
    ];
  }
  if (signals.redirectChain.data) {
    signals.redirectChain.data.content = {
      title: "Sign in",
      crossOriginFormHosts: ["collect.example"],
      crossOriginPasswordFormHosts: ["collect.example"],
      passwordInputCount: 1,
      iframeCount: 0,
      hiddenIframeCount: 0,
      obfuscationHints: ["eval", "atob"],
      metaRefreshTarget: null,
    };
  }
  if (signals.virusTotal.data) signals.virusTotal.data.harmless = 10;
  return signals;
}
