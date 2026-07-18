/**
 * Browser CSP helpers for Scrutinix.
 *
 * connect-src stays 'self' (+ local ws in dev). Threat-provider hosts are
 * intentionally omitted: the browser only talks to same-origin /api/*, and
 * server-side adapters call VT/GSB/feeds/etc. (Node fetch ignores CSP).
 */

const isDevelopment = process.env.NODE_ENV !== "production";

export function createCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("base64");
}

export function buildContentSecurityPolicy(nonce: string): string {
  const connectSrc = [
    "connect-src 'self'",
    isDevelopment
      ? "http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  // script-src: nonce + strict-dynamic (Next attaches the nonce to framework
  // scripts). No 'unsafe-inline' in production. 'unsafe-eval' only in dev.
  const scriptSrc = [
    "script-src 'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    isDevelopment ? "'unsafe-eval'" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    connectSrc,
    scriptSrc,
    // Tailwind / next-themes still rely on inline styles; tighten later.
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
  ]
    .join("; ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
