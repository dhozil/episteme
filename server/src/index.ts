/**
 * Episteme — standalone REST API server.
 *
 * Run: npm run start --workspace @verify/server
 * Env: SERVER_CONTRACT, SERVER_RPC, SERVER_PORT, SERVER_PRIVATE_KEY
 */

import http from "node:http";
import { route, CONTRACT } from "./handler";

const PORT = Number(process.env.SERVER_PORT ?? 8787);

async function readBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const body = await readBody(req);
      const result = await route({
        method: req.method ?? "GET",
        path: url.pathname,
        search: url.searchParams,
        body,
      });
      res.writeHead(result.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.body, null, 2));
    } catch (e: any) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  })
  .listen(PORT, () => {
    console.log(`Episteme API listening on :${PORT}`);
    console.log(`Contract: ${CONTRACT}`);
  });
