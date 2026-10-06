/**
 * Frequently-impersonated brands. Isomorphic (no Node built-ins), so both
 * the scoring heuristics (`url-structure-risk.ts`) and the browser's link
 * anatomy (`link-anatomy.ts`) read the same list.
 *
 * Only names with 5+ characters participate in edit-distance matching
 * (shorter ones create false positives); all participate in exact-label
 * checks.
 */
export const IMPERSONATED_BRANDS = [
  "adobe",
  "airbnb",
  "amazon",
  "americanexpress",
  "apple",
  "bankofamerica",
  "barclays",
  "binance",
  "bitwarden",
  "blockchain",
  "booking",
  "chase",
  "citibank",
  "coinbase",
  "discord",
  "dropbox",
  "facebook",
  "fedex",
  "github",
  "gmail",
  "google",
  "hsbc",
  "icloud",
  "instagram",
  "linkedin",
  "metamask",
  "microsoft",
  "netflix",
  "office365",
  "outlook",
  "paypal",
  "roblox",
  "santander",
  "spotify",
  "steam",
  "telegram",
  "twitter",
  "walmart",
  "wellsfargo",
  "whatsapp",
  "yahoo",
] as const;

export const IMPERSONATED_BRAND_SET: ReadonlySet<string> = new Set(
  IMPERSONATED_BRANDS,
);
