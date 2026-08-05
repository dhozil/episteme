/**
 * Vercel serverless function — exposes the Episteme REST API at /api/*.
 * Reads and fast submits work within Vercel limits; consensus-waiting
 * endpoints (POST /verify/wait) may exceed the function timeout, so clients
 * should POST /verify (fast) and poll GET /verification/:id.
 */

import { route, CONTRACT } from "../server/src/handler";

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
