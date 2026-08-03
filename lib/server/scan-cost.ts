import { parseScanRequest } from "@/lib/server/scan-request";

/**
 * Admitted batches consume one token per normalized URL. Rejected requests
 * cost one token, preventing a batch-looking invalid body from amplifying its
 * own debit. Parsing a clone preserves the route handler's request body.
 */
export async function getScanRequestCost(
  request: Request,
  pathname: string,
): Promise<number> {
  if (pathname !== "/api/analyze/batch") {
    return 1;
  }

  const parsed = await parseScanRequest(request.clone(), "batch");
  return parsed.ok ? parsed.targets.length : 1;
}
