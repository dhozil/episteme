/**
 * Vercel serverless function entry — source of truth for api/[...all].js.
 *
 * The deployed function is a single self-contained CommonJS bundle produced
 * by `npm run build:api` (esbuild). Bundling inlines genlayer-js so the
 * function never does `require(esm)` at runtime; Vercel's function runtime
 * rejects require() of ES Modules (ERR_REQUIRE_ESM), which crashed every
 * request when the SDK was loaded from node_modules.
 *
 * Reads and fast submits work within Vercel limits; consensus-waiting
 * endpoints (POST /verify/wait) may exceed the function timeout, so clients
 * should POST /verify (fast) and poll GET /verification?id=:id.
 *
 * NOTE: Vercel's catch-all only matches single-segment /api/* paths, so
 * resource lookups use query params (GET /verification?id=, GET /policy?id=)
 * instead of sub-paths.
 */

import { route, CONTRACT } from "./handler.js";

export const config = {
  maxDuration: 60,
};

export default async function handler(req: any, res: any) {
  const method = req.method ?? "GET";
  const url: string = req.url ?? "/";
  const [pathPart, queryPart] = url.split("?");
  let path = pathPart.startsWith("/api") ? pathPart.slice(4) : pathPart;
  if (!path || path === "/") path = "/health";
  const result = await route({
    method,
    path,
    search: new URLSearchParams(queryPart ?? ""),
    body: req.body ?? {},
  });
  res.status(result.status).json(result.body);
}
