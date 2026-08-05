/**
 * Continuous monitor for verification records.
 *
 * Each cycle:
 *  1. Reads recent verifications from the chain.
 *  2. Detects state changes (new / status / decision / version / consensus).
 *  3. Emits notifications (console + optional webhook).
 *  4. Auto-reverifies records this account owns that are near expiry
 *     (continuous verification / living verified state).
 *
 * Usage:
 *   npm run once  --workspace @verify/monitor   # single cycle
 *   npm run start --workspace @verify/monitor   # infinite loop
 *
 * Env:
 *   MONITOR_CONTRACT, MONITOR_RPC, MONITOR_POLL_MS,
 *   MONITOR_STATE, MONITOR_WEBHOOK_URL,
 *   MONITOR_REVERIFY_THRESHOLD_S, MONITOR_PRIVATE_KEY
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAccount } from "genlayer-js";
import { Verifier } from "@verify/sdk";
import type { VerificationRecord } from "@verify/sdk";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CONTRACT =
  process.env.MONITOR_CONTRACT ??
  "0xE5C9A821b0Fa27Fe8d8DE0e74a55C0fdc17760ff";
const RPC = process.env.MONITOR_RPC ?? "https://studio.genlayer.com/api";
const POLL_MS = Number(process.env.MONITOR_POLL_MS ?? 60_000);
const STATE_FILE =
  process.env.MONITOR_STATE ?? resolve(__dirname, "..", "state.json");
const WEBHOOK_URL = process.env.MONITOR_WEBHOOK_URL;
const REVERIFY_THRESHOLD_S = Number(
  process.env.MONITOR_REVERIFY_THRESHOLD_S ?? 86_400,
);
const OWNER_KEY = process.env.MONITOR_PRIVATE_KEY;

interface Snapshot {
  status: string;
  decision: string;
  version: number;
  consensus: string;
}

function snapshotOf(rec: VerificationRecord): Snapshot {
  return {
    status: rec.status,
    decision: rec.decision,
    version: rec.version,
    consensus: rec.consensus,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class Monitor {
  private verifier: Verifier;
  private state: Record<string, Snapshot> = {};

  constructor() {
    this.verifier = new Verifier({
      contractAddress: CONTRACT,
      endpoint: RPC,
      account: OWNER_KEY ? createAccount(OWNER_KEY as `0x${string}`) : undefined,
      pollIntervalMs: 15_000,
      waitTimeoutMs: 30 * 60_000,
    });
    this.loadState();
  }

  private loadState(): void {
    try {
      if (existsSync(STATE_FILE)) {
        this.state = JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      }
    } catch {
      this.state = {};
    }
  }

  private saveState(): void {
    writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), "utf-8");
  }

  private async notify(message: string): Promise<void> {
    console.log(new Date().toISOString(), "\n" + message);
    if (WEBHOOK_URL) {
      try {
        await fetch(WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            text: message,
            time: new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.error("webhook failed:", e);
      }
    }
  }

  private isOwner(rec: VerificationRecord): boolean {
    return (
      rec.owner.toLowerCase() === this.verifier.account.address.toLowerCase()
    );
  }

  private nearExpiry(expiresAt: string): boolean {
    const exp = Date.parse(expiresAt);
    if (Number.isNaN(exp)) return false;
    return exp > Date.now() && exp - Date.now() < REVERIFY_THRESHOLD_S * 1000;
  }

  async cycle(): Promise<void> {
    const recent = await this.verifier.getRecentVerifications(50);
    const changed: string[] = [];

    for (const rec of recent) {
      const id = rec.verification_id;
      const snap = snapshotOf(rec);

      const prev = this.state[id];
      if (!prev) {
        changed.push(`NEW ${id} -> ${rec.decision} (${rec.status}, v${rec.version})`);
        this.state[id] = snap;
      } else {
        const diffs: string[] = [];
        for (const key of ["status", "decision", "version", "consensus"] as const) {
          if (prev[key] !== snap[key]) {
            diffs.push(`${key}: ${prev[key]} -> ${snap[key]}`);
          }
        }
        if (diffs.length) {
          changed.push(`${id}: ${diffs.join(", ")}`);
          this.state[id] = snap;
        }
      }

      if (this.isOwner(rec) && this.nearExpiry(rec.expires_at)) {
        const urls = (rec.sources ?? []).map((s) => s.url);
        if (urls.length) {
          try {
            const { txHash } = await this.verifier.reverify({
              verificationId: id,
              urls,
            });
            changed.push(`AUTO-REVERIFY ${id} -> tx ${txHash} (queued for consensus)`);
          } catch (e) {
            changed.push(`REVERIFY FAILED ${id}: ${(e as Error).message}`);
          }
        }
      }
    }

    this.saveState();
    if (changed.length) {
      await this.notify(changed.join("\n"));
    } else {
      console.log(new Date().toISOString(), "no changes");
    }
  }

  async runLoop(): Promise<void> {
    for (;;) {
      try {
        await this.cycle();
      } catch (e) {
        console.error(new Date().toISOString(), "cycle error:", e);
      }
      await sleep(POLL_MS);
    }
  }
}

async function main(): Promise<void> {
  const monitor = new Monitor();
  const mode = process.argv[2] ?? "once";
  if (mode === "loop") {
    await monitor.runLoop();
  } else {
    await monitor.cycle();
  }
}

main().catch((e) => {
  console.error("monitor failed:", e);
  process.exit(1);
});
