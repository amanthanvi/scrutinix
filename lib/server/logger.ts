import { createHash } from "node:crypto";

export function hashUrlForLogs(url: string) {
  return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

export function createSafeLogContext(
  url: string,
  fields: Record<string, unknown> = {},
) {
  return {
    urlHash: hashUrlForLogs(url),
    ...fields,
  };
}

export function logInfo(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", event, ...fields }));
}

export function logWarn(event: string, fields: Record<string, unknown>) {
  console.warn(JSON.stringify({ level: "warn", event, ...fields }));
}

export function logError(event: string, fields: Record<string, unknown>) {
  console.error(JSON.stringify({ level: "error", event, ...fields }));
}
