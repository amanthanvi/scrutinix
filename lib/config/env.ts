import "server-only";

import * as z from "zod";

/**
 * Empty strings are treated as unset so a copied .env.example (which ships
 * `KEY=` placeholders) degrades providers gracefully instead of failing
 * every scan with a ZodError.
 */
const emptyAsUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(
  emptyAsUndefined,
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(emptyAsUndefined, z.string().url().optional());

/** Shortest share-signing secret accepted (an HMAC-SHA256 key). */
export const MIN_SHARE_SECRET_LENGTH = 32;

/**
 * The e2e suite's share-signing key, committed in `scripts/run-e2e.mjs`.
 * Anyone can read it, so it signs only in test-fixture mode, and is the
 * only key that does: see `shareSecretProblem`.
 */
const PUBLISHED_TEST_SHARE_SECRETS: ReadonlySet<string> = new Set([
  "e2e-only-share-signing-key-not-a-real-secret-0001",
]);

/**
 * Why a configured share secret is ignored, or null when it is usable.
 *
 * Test-fixture mode and real signing are mutually exclusive. Fixtures
 * (`SCRUTINIX_TEST_FIXTURES=1`) score any unknown host Safe, so a real key
 * there would sign a "Safe" for any link anyone asks about: only the
 * published e2e key is accepted. Outside fixture mode that key is public,
 * so it is always refused: a deploy that copied it gets unsigned shares,
 * not forgeable "Verified" links.
 */
function shareSecretProblem(value: unknown): string | null {
  const raw = emptyAsUndefined(value);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  const published = PUBLISHED_TEST_SHARE_SECRETS.has(trimmed);
  if (process.env.SCRUTINIX_TEST_FIXTURES === "1") {
    return published
      ? null
      : "test fixtures are on, which accept only the published e2e test key";
  }
  if (published) {
    return "the published e2e test key";
  }
  if (trimmed.length < MIN_SHARE_SECRET_LENGTH) {
    return `shorter than ${MIN_SHARE_SECRET_LENGTH} characters`;
  }
  return null;
}

/**
 * A share-signing secret: trimmed, and unset when empty or refused by
 * `shareSecretProblem` (a weak or public key would let anyone forge
 * "Verified Scrutinix result" links, and a real key in fixture mode would
 * sign fixture verdicts, so either is ignored rather than used).
 */
const optionalSecret = z
  .preprocess(emptyAsUndefined, z.string().optional())
  .transform((value) =>
    value !== undefined && shareSecretProblem(value) === null
      ? value.trim()
      : undefined,
  );

const SHARE_SECRET_KEYS = [
  "SHARE_SIGNING_SECRET",
  "SHARE_SIGNING_SECRET_PREVIOUS",
] as const;

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  VIRUSTOTAL_API_KEY: optionalString,
  GOOGLE_SAFE_BROWSING_API_KEY: optionalString,
  URLHAUS_AUTH_KEY: optionalString,
  /** Spamhaus Data Query Service key; public DBL mirrors block cloud resolvers. */
  SPAMHAUS_DQS_KEY: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  /**
   * HMAC key that signs share links (`lib/server/share-signing.ts`). Unset:
   * shared links open the neutral "check it yourself" view.
   */
  SHARE_SIGNING_SECRET: optionalSecret,
  /** The previous key during rotation; verifies links, never signs. */
  SHARE_SIGNING_SECRET_PREVIOUS: optionalSecret,
  OPENPHISH_FEED_URL: z.preprocess(
    emptyAsUndefined,
    z.string().url().default("https://openphish.com/feed.txt"),
  ),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;
let warnedWeakSecret = false;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  warnAboutWeakShareSecrets(cachedEnv);
  return cachedEnv;
}

/** Once per process, and never with the value itself. */
function warnAboutWeakShareSecrets(env: AppEnv) {
  if (warnedWeakSecret) return;
  const ignored = SHARE_SECRET_KEYS.flatMap((key) => {
    const reason = shareSecretProblem(process.env[key]);
    return reason && !env[key] ? [{ key, reason }] : [];
  });
  if (!ignored.length) return;
  warnedWeakSecret = true;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "share_secret_ignored",
      keys: ignored.map((entry) => entry.key),
      reasons: ignored.map((entry) => entry.reason),
    }),
  );
}

export function resetEnvForTests() {
  cachedEnv = null;
  warnedWeakSecret = false;
}

export function isProviderConfigured(key: keyof AppEnv) {
  const value = getEnv()[key];
  return typeof value === "string" && value.length > 0;
}
