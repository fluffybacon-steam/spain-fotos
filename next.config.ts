// next.config.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// Turbopack walks upwards looking for a lockfile to infer the workspace root.
// If a stray package-lock.json exists in a parent folder it picks that instead,
// which silently changes module resolution. Pin it to this directory.
const here = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: { root: here },

  // heic-to loads libheif as WebAssembly and needs eval permission.
  // If you tighten CSP later, keep 'wasm-unsafe-eval' in script-src.
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner"],
};

export default nextConfig;
