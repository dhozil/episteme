/**
 * Shared request router for the Episteme API.
 * Used by both the standalone Node server and the Vercel serverless function.
 */

import { createAccount } from "genlayer-js";
import {
  Verifier,
  isExecutionSuccess,
  executionError,
} from "../../sdk/src/verifier.js";

export const CONTRACT =
  process.env.SERVER_CONTRACT ??
  "0xE5C9A821b0Fa27Fe8d8DE0e74a55C0fdc17760ff";
const RPC = process.env.SERVER_RPC ?? "https://studio.genlayer.com/api";

export const verifier = new Verifier({
  contractAddress: CONTRACT,
  endpoint: RPC,
  account: process.env.SERVER_PRIVATE_KEY
    ? (createAccount(process.env.SERVER_PRIVATE_KEY as `0x${string}`) as any)
    : undefined,
});

export interface RouteRequest {
  method: string;
  path: string;
  search: URLSearchParams;
  body: any;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

export async function route(req: RouteRequest): Promise<RouteResult> {
  const { method, path } = req;
  const body = req.body ?? {};

  try {
    // ---- GET /health
    if (method === "GET" && path === "/health") {
      return { status: 200, body: { ok: true, contract: CONTRACT } };
    }

    // ---- GET /policies
    if (method === "GET" && path === "/policies") {
      return { status: 200, body: { policies: await verifier.getPolicyIds() } };
    }

    // ---- GET /policy?id=:id
    if (method === "GET" && path === "/policy") {
      const policyId = req.search.get("id");
      if (!policyId) {
        return { status: 400, body: { error: "id query param is required" } };
      }
      return { status: 200, body: await verifier.getPolicy(policyId) };
    }

    // ---- GET /verifications?limit=50
    if (method === "GET" && path === "/verifications") {
      const limit = Math.min(Number(req.search.get("limit") ?? 50) || 50, 50);
      return { status: 200, body: { verifications: await verifier.getRecentVerifications(limit) } };
    }

    // ---- GET /verification?id=:id
    if (method === "GET" && path === "/verification") {
      const verificationId = req.search.get("id");
      if (!verificationId) {
        return { status: 400, body: { error: "id query param is required" } };
      }
      return { status: 200, body: await verifier.getVerification(verificationId) };
    }

    // ---- POST /verify
    if (method === "POST" && path === "/verify") {
      if (!body.question || !body.policyId || !Array.isArray(body.urls)) {
        return { status: 400, body: { error: "question, policyId, urls (array) are required" } };
      }
      const { txHash } = await verifier.verify({
        question: body.question,
        policyId: body.policyId,
        urls: body.urls,
      });
      return { status: 202, body: { txHash } };
    }

    // ---- POST /verify/wait
    if (method === "POST" && path === "/verify/wait") {
      if (!body.question || !body.policyId || !Array.isArray(body.urls)) {
        return { status: 400, body: { error: "question, policyId, urls (array) are required" } };
      }
      const { txHash, receipt, executed } = await verifier.verifyAndWait({
        question: body.question,
        policyId: body.policyId,
        urls: body.urls,
      });
      if (!executed) {
        return { status: 502, body: { txHash, error: executionError(receipt) ?? "consensus rejected" } };
      }
      const newest = await verifier.getRecentVerifications(1);
      return { status: 200, body: { txHash, verification: newest[0] ?? null } };
    }

    // ---- POST /challenge
    if (method === "POST" && path === "/challenge") {
      if (!body.verificationId || !body.reason) {
        return { status: 400, body: { error: "verificationId and reason are required" } };
      }
      const { txHash } = await verifier.challenge({
        verificationId: body.verificationId,
        reason: body.reason,
      });
      return { status: 202, body: { txHash } };
    }

    // ---- POST /reverify
    if (method === "POST" && path === "/reverify") {
      if (!body.verificationId || !Array.isArray(body.urls)) {
        return { status: 400, body: { error: "verificationId and urls (array) are required" } };
      }
      const { txHash } = await verifier.reverify({
        verificationId: body.verificationId,
        urls: body.urls,
      });
      return { status: 202, body: { txHash } };
    }

    return { status: 404, body: { error: "Not found" } };
  } catch (e: any) {
    return { status: 500, body: { error: String(e?.message ?? e) } };
  }
}
