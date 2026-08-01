import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

// CSP (script-src nonce + narrow connect-src) is set per-request in proxy.ts.
// Static headers() cannot supply a fresh nonce, so CSP lives only there.
const securityHeaders = [
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=()",
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin",
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff",
  },
  {
    key: "X-Frame-Options",
    value: "DENY",
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  turbopack: {
    root: rootDir,
  },
  // The local URL classifier: keep the ONNX runtime native and make sure the
  // bundled model weights ride along with the analyze routes.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  outputFileTracingIncludes: {
    "/api/analyze/**": ["./lib/server/ml/model/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
