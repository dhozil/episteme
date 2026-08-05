import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { isDecidedState } from "genlayer-js/types";

import type {
  ChallengeOptions,
  Policy,
  ReverifyOptions,
  TxReceipt,
  VerificationRecord,
  VerifierConfig,
  VerifyOptions,
  WriteResult,
} from "./types.js";

const DEFAULT_ENDPOINT = "https://studio.genlayer.com/api";

const MIN_GAS_PRICE = "0x3b9aca00"; // 1 gwei — studionet rejects feeCap 0

/** Methods the wallet signs/forwards; everything else goes to the RPC. */
const WALLET_METHODS = new Set([
  "eth_accounts",
  "eth_requestAccounts",
  "eth_sendTransaction",
  "eth_signTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTypedData_v4",
]);

/**
 * Split provider (Praetor pattern): wallet handles signing, the RPC endpoint
 * handles gas estimation / reads. Passing MetaMask as the full provider makes
 * genlayer-js query it for eth_gasPrice, which yields feeCap 0 on Studionet.
 */
function splitProvider(wallet: any, endpoint: string) {
  return {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (WALLET_METHODS.has(method)) {
        return wallet.request({ method, params });
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
      });
      const json = await res.json();
      if (json?.error) {
        const err: any = new Error(json.error.message || "RPC error");
        err.code = json.error.code;
        err.data = json.error.data;
        throw err;
      }
      return json?.result;
    },
  };
}

/** Studionet returns eth_gasPrice = 0, which wallets send as feeCap 0 and the
 *  node rejects. Enforce a minimum fee on wallet-submitted txs. */
function ensureMinGasPrice(tx: any): void {
  const gp = tx.gasPrice;
  let zero = gp == null;
  if (!zero) {
    try {
      zero = BigInt(String(gp).replace(/^0x/, "") || "0") === 0n;
    } catch {
      zero = false;
    }
  }
  if (zero) {
    tx.gasPrice = MIN_GAS_PRICE;
    tx.maxFeePerGas = MIN_GAS_PRICE;
    tx.maxPriorityFeePerGas = MIN_GAS_PRICE;
  }
}

/**
 * Client for the AI Verification / Decision Network contract.
 *
 * Reads are synchronous RPC calls. Writes submit a transaction and you
 * either poll manually with `waitForReceipt` or use the `*AndWait` helpers
 * which block until the transaction reaches a decided state.
 */
export class Verifier {
  readonly contractAddress: string;
  readonly account: { address: string };

  private readonly client: any;
  private readonly reader: any;
  private readonly signer: any;
  private readonly walletMode: boolean;
  private readonly endpoint: string;
  private readonly waitTimeoutMs: number;
  private readonly pollIntervalMs: number;

  constructor(config: VerifierConfig) {
    this.contractAddress = config.contractAddress;
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.waitTimeoutMs = config.waitTimeoutMs ?? 30 * 60_000;
    this.pollIntervalMs = config.pollIntervalMs ?? 15_000;
    const chain = (config.chain as any) ?? studionet;

    if (config.provider && config.account) {
      // Wallet mode: writes signed by the injected wallet provider.
      const address =
        typeof config.account === "string"
          ? config.account
          : (config.account as any).address;
      this.account = { address };
      this.signer = null;
      this.walletMode = true;
      const walletClient: any = createClient({
        chain,
        endpoint: this.endpoint,
        account: address as any,
        provider: splitProvider(config.provider as any, this.endpoint),
      });
      const origRequest = walletClient.request.bind(walletClient);
      walletClient.request = async (args: any) => {
        if (args?.method === "eth_gasPrice") {
          // Studionet reports 0; return a floor so txs get a valid feeCap.
          return MIN_GAS_PRICE;
        }
        if (
          args?.method === "eth_sendTransaction" &&
          Array.isArray(args?.params) &&
          args.params[0]
        ) {
          ensureMinGasPrice(args.params[0]);
        }
        return origRequest(args);
      };
      this.client = walletClient;
      this.reader = createClient({ chain, endpoint: this.endpoint });
    } else if (config.account) {
      // Local-account mode (scripts / backend, not the browser default).
      const acct = config.account as any;
      this.account = acct;
      this.signer = acct;
      this.walletMode = false;
      this.client = createClient({
        chain,
        endpoint: this.endpoint,
        account: acct,
      });
      this.reader = this.client;
    } else {
      // Read-only mode: no signer, reads only.
      this.account = { address: "" };
      this.signer = null;
      this.walletMode = false;
      this.client = null;
      this.reader = createClient({ chain, endpoint: this.endpoint });
    }
  }

  /** Best-effort: ask the wallet to switch to the given network. */
  async connectWallet(network = "studionet"): Promise<void> {
    if (this.client?.connect) {
      try {
        await this.client.connect(network);
      } catch {
        /* wallet/network switch is best-effort */
      }
    }
  }

  // ---------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------

  private async read<T = any>(functionName: string, args: any[] = []): Promise<T> {
    return this.reader.readContract({
      address: this.contractAddress,
      functionName,
      args,
    });
  }

  getPolicy(policyId: string): Promise<Policy> {
    return this.read("get_policy", [policyId]);
  }

  getPolicyIds(): Promise<string[]> {
    return this.read("get_policy_ids", []);
  }

  getStats(): Promise<Record<string, any>> {
    return this.read("get_stats", []);
  }

  getVerification(verificationId: string): Promise<VerificationRecord> {
    return this.read("get_verification", [verificationId]);
  }

  getRecentVerifications(n = 10): Promise<VerificationRecord[]> {
    return this.read("get_recent_verifications", [n]);
  }

  getMyVerifications(): Promise<string[]> {
    return this.read("get_my_verifications", []);
  }

  getVerificationSummary(verificationId: string): Promise<string> {
    return this.read("get_verification_summary", [verificationId]);
  }

  // ---------------------------------------------------------------
  // Writes
  // ---------------------------------------------------------------

  private async submit(functionName: string, args: any[]): Promise<WriteResult> {
    if (!this.client || !this.signer && !this.walletMode) {
      throw new Error("Verifier is in read-only mode — connect a wallet to write");
    }
    const params: any = {
      address: this.contractAddress,
      functionName,
      args,
      value: 0n,
    };
    if (!this.walletMode) {
      // Local mode: pass the viem account for signing.
      params.account = this.signer;
    }
    const txHash = await this.client.writeContract(params);
    return { txHash };
  }

  verify(options: VerifyOptions): Promise<WriteResult> {
    return this.submit("verify_with_policy", [
      options.question,
      options.policyId,
      JSON.stringify(options.urls),
    ]);
  }

  challenge(options: ChallengeOptions): Promise<WriteResult> {
    return this.submit("challenge", [options.verificationId, options.reason]);
  }

  reverify(options: ReverifyOptions): Promise<WriteResult> {
    return this.submit("reverify", [
      options.verificationId,
      JSON.stringify(options.urls),
    ]);
  }

  // ---------------------------------------------------------------
  // Receipt waiting
  // ---------------------------------------------------------------

  /**
   * Polls until the transaction reaches a decided state
   * (ACCEPTED / FINALIZED / UNDETERMINED / CANCELED).
   */
  async waitForReceipt(txHash: string): Promise<TxReceipt> {
    const deadline = Date.now() + this.waitTimeoutMs;
    for (;;) {
      const tx = await this.client.getTransaction({ hash: txHash });
      if (tx && isDecidedState(String(tx.status))) {
        return tx;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `Transaction ${txHash} not decided within ${this.waitTimeoutMs}ms`,
        );
      }
      await sleep(this.pollIntervalMs);
    }
  }

  async verifyAndWait(
    options: VerifyOptions,
  ): Promise<{ txHash: string; receipt: TxReceipt; executed: boolean }> {
    const { txHash } = await this.verify(options);
    const receipt = await this.waitForReceipt(txHash);
    return { txHash, receipt, executed: isExecutionSuccess(receipt) };
  }

  /** Raw on-chain transaction (consensus votes, rounds, result). */
  getTransaction(txHash: string): Promise<any> {
    return this.client.getTransaction({ hash: txHash });
  }

  async challengeAndWait(
    options: ChallengeOptions,
  ): Promise<{ txHash: string; receipt: TxReceipt; executed: boolean }> {
    const { txHash } = await this.challenge(options);
    const receipt = await this.waitForReceipt(txHash);
    return { txHash, receipt, executed: isExecutionSuccess(receipt) };
  }
}

export function isExecutionSuccess(receipt: TxReceipt): boolean {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  return leader?.execution_result === "SUCCESS";
}

export function isExecutionError(receipt: TxReceipt): boolean {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  return leader?.execution_result === "ERROR";
}

export function executionError(receipt: TxReceipt): string | null {
  const leader = receipt?.consensus_data?.leader_receipt?.[0];
  const err = leader?.genvm_result?.raw_error ?? leader?.genvm_result?.error_description;
  return err ? String(err) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
