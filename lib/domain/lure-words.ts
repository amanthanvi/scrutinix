/**
 * Words phishing links use to lure people. The structure checks
 * (`lib/server/providers/ml-ensemble.ts`) count each one found anywhere in
 * the link's host, path, or query; the link pattern model's ID rule
 * (`lib/server/ml/local-classifier.ts`) keeps any ID-like run that spells
 * one of the five-letter-or-longer ones.
 */
export const HIGH_RISK_KEYWORDS = [
  "login",
  "verify",
  "secure",
  "wallet",
  "reset",
  "invoice",
  "update",
  "banking",
  "mfa",
  "gift-card",
  "airdrop",
  "auth",
] as const;
