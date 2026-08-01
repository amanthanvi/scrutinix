import { z } from "zod";

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

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  NEXT_PUBLIC_APP_URL: optionalUrl,
  VIRUSTOTAL_API_KEY: optionalString,
  GOOGLE_SAFE_BROWSING_API_KEY: optionalString,
  HUGGINGFACE_API_KEY: optionalString,
  URLHAUS_AUTH_KEY: optionalString,
  UPSTASH_REDIS_REST_URL: optionalUrl,
  UPSTASH_REDIS_REST_TOKEN: optionalString,
  HUGGINGFACE_URL_MODEL: z.preprocess(
    emptyAsUndefined,
    z.string().min(1).default("DunnBC22/codebert-base-Malicious_URLs"),
  ),
  OPENPHISH_FEED_URL: z.preprocess(
    emptyAsUndefined,
    z.string().url().default("https://openphish.com/feed.txt"),
  ),
});

export type AppEnv = z.infer<typeof envSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function resetEnvForTests() {
  cachedEnv = null;
}

export function isProviderConfigured(key: keyof AppEnv) {
  const value = getEnv()[key];
  return typeof value === "string" && value.length > 0;
}
