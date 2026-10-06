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
