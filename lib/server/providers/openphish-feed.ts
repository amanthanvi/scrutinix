import { getEnv } from "@/lib/config/env";
import { simplifyUrlForMatching } from "@/lib/domain/url";
import { fetchWithTimeout } from "@/lib/server/http";
import type { ThreatFeedsData } from "@/lib/domain/types";

interface FeedCache {
  fetchedAt: number;
  values: Set<string>;
  hosts: Set<string>;
}

declare global {
  var __openPhishFeedCache: FeedCache | undefined;
  var __openPhishFeedInflight: Promise<FeedCache> | undefined;
}

const TTL_MS = 1000 * 60 * 15;

export async function checkOpenPhishFeed(
  url: string,
): Promise<ThreatFeedsData["matches"][number] | null> {
  const feed = await getOpenPhishFeed();
  const normalized = simplifyUrlForMatching(url);

  if (feed.values.has(normalized)) {
    return {
      feed: "openphish",
      matchedUrl: normalized,
      detail: "listed in the OpenPhish community feed",
      confidence: "high",
      matchType: "url",
    };
  }

  // Exact-URL matching alone has a near-zero hit rate once query strings
  // vary; fall back to hostname-level matching at lower confidence.
  const hostname = extractHostname(normalized);
  if (hostname && feed.hosts.has(hostname)) {
    return {
      feed: "openphish",
      matchedUrl: hostname,
      detail:
        "hostname appears in the OpenPhish community feed (different path)",
      confidence: "medium",
      matchType: "host",
    };
  }

  return null;
}

function extractHostname(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

async function getOpenPhishFeed() {
  const cached = globalThis.__openPhishFeedCache;
  if (cached && cached.fetchedAt + TTL_MS > Date.now()) {
    return cached;
  }

  // Single-flight: a cold cache plus a 10-URL batch must not trigger ten
  // concurrent full-feed downloads. The download deliberately ignores
  // per-scan abort signals - it is a shared resource with its own timeout.
  if (!globalThis.__openPhishFeedInflight) {
    globalThis.__openPhishFeedInflight = downloadOpenPhishFeed().finally(() => {
      globalThis.__openPhishFeedInflight = undefined;
    });
  }

  return globalThis.__openPhishFeedInflight;
}

async function downloadOpenPhishFeed(): Promise<FeedCache> {
  const env = getEnv();
  const response = await fetchWithTimeout(env.OPENPHISH_FEED_URL, {}, 8_000);
  if (!response.ok) {
    throw new Error(
      `OpenPhish feed download failed with status ${response.status}.`,
    );
  }

  const text = await response.text();
  const values = new Set<string>();
  const hosts = new Set<string>();

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const simplified = simplifyUrlForMatching(trimmed);
    values.add(simplified);
    const hostname = extractHostname(simplified);
    if (hostname) {
      hosts.add(hostname);
    }
  }

  const nextCache = {
    fetchedAt: Date.now(),
    values,
    hosts,
  };

  globalThis.__openPhishFeedCache = nextCache;
  return nextCache;
}
