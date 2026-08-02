/** Upstash REST credentials, with Vercel KV aliases accepted. */
export function getRedisRestConfig() {
  return {
    url: firstNonEmpty(
      process.env.UPSTASH_REDIS_REST_URL,
      process.env.KV_REST_API_URL,
    ),
    token: firstNonEmpty(
      process.env.UPSTASH_REDIS_REST_TOKEN,
      process.env.KV_REST_API_TOKEN,
    ),
  };
}

function firstNonEmpty(...values: Array<string | undefined>) {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return undefined;
}
