import { Verifier } from "@verify/sdk";

const CONTRACT =
  (import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined) ??
  "0x8934dfd22A3CF8082B443AF80786da2EFE646f08";

const RPC =
  (import.meta.env.VITE_RPC_URL as string | undefined) ??
  "https://studio.genlayer.com/api";

const OPTS = { pollIntervalMs: 15_000, waitTimeoutMs: 30 * 60_000 };

let verifier: Verifier | null = null;

/** Singleton Verifier. Defaults to read-only until a wallet is connected. */
export function getVerifier(): Verifier {
  if (!verifier) verifier = new Verifier({ contractAddress: CONTRACT, endpoint: RPC, ...OPTS });
  return verifier;
}

/** Silent wallet detection: no popup, no network switch. */
export async function trySilentConnect(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  try {
    const accounts = await eth.request({ method: "eth_accounts" });
    if (!accounts?.length) return null;
    const address: string = accounts[0];
    verifier = new Verifier({
      contractAddress: CONTRACT,
      endpoint: RPC,
      account: address,
      provider: eth,
      ...OPTS,
    });
    return address;
  } catch {
    return null;
  }
}

/** Connect the injected wallet (MetaMask/Rabby) for signing writes. */
export async function connectWallet(): Promise<string | null> {
  const eth = (window as any).ethereum;
  if (!eth) return null;
  const accounts = await eth.request({ method: "eth_requestAccounts" });
  if (!accounts?.length) return null;
  const address: string = accounts[0];
  verifier = new Verifier({
    contractAddress: CONTRACT,
    endpoint: RPC,
    account: address,
    provider: eth,
    ...OPTS,
  });
  try {
    await verifier.connectWallet("studionet");
  } catch {
    /* best-effort network switch */
  }
  return address;
}

export function accountAddress(): string {
  return getVerifier().account.address;
}

/** Disconnect the wallet: revert to read-only mode. */
export function disconnectWallet(): void {
  verifier = null;
}

export function walletAvailable(): boolean {
  return typeof window !== "undefined" && !!(window as any).ethereum;
}

// ---------------------------------------------------------------
// Track the on-chain tx hash that created each verification, so the
// record view can link to the explorer.
// ---------------------------------------------------------------

const TX_KEY = "episteme_tx_map";

export function saveVerificationTx(vid: string, txHash: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(TX_KEY) || "{}");
    map[vid] = txHash;
    localStorage.setItem(TX_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

export function getVerificationTx(vid: string): string {
  try {
    const map = JSON.parse(localStorage.getItem(TX_KEY) || "{}");
    return map[vid] || "";
  } catch {
    return "";
  }
}
