import { Verifier, isExecutionSuccess, isExecutionError, executionError } from "../src/index";
import { createAccount } from "genlayer-js";

const CONTRACT = process.argv[2] || process.env.TEST_CONTRACT;
const OM_API =
  "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto";

const VOTE: Record<string, string> = { "1": "AGREE", "2": "DISAGREE", "3": "TIMEOUT", "0": "NOT_VOTED" };

async function main() {
  if (!CONTRACT) throw new Error("usage: tsx scripts/acceptance.ts <contract-address>");
  const verifier = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  console.log("ACCEPTANCE TEST — contract", CONTRACT);
  let pass = 0;
  let fail = 0;
  const check = (label: string, ok: boolean, detail = "") => {
    if (ok) { pass++; console.log(`  [PASS] ${label}`); }
    else { fail++; console.log(`  [FAIL] ${label} ${detail}`); }
  };

  console.log("\n== 1. Built-in policies ==");
  const ids = await verifier.getPolicyIds();
  const expected = ["grant-v1", "dao-proposal-v1", "company-status-v1", "insurance-claim-v1", "service-status-v1"];
  check("exactly 5 built-in policies, no extras", ids.length === 5 && expected.every((x) => ids.includes(x)), JSON.stringify(ids));

  console.log("\n== 2. verify_with_policy (service-status -> PASS) ==");
  const { txHash, receipt, executed } = await verifier.verifyAndWait({
    question: "Is the open-meteo weather API reachable and returning valid, current data right now?",
    policyId: "service-status-v1",
    urls: [OM_API, "https://open-meteo.com/en"],
  });
  check("verify executed (consensus)", executed, txHash);
  const tx = await verifier.getTransaction(txHash);
  const resultName = tx?.result_name ?? "?";
  const votes = ((tx?.last_round?.validator_votes) ?? []).map((v: string) => VOTE[String(v)] ?? String(v));
  check("consensus MAJORITY_AGREE", resultName === "MAJORITY_AGREE", `${resultName} votes=${JSON.stringify(votes)}`);
  const newest = await verifier.getRecentVerifications(1);
  const rec = newest[0];
  check("decision is PASS or NEEDS_REVIEW (positive)", ["PASS", "NEEDS_REVIEW"].includes(rec?.decision ?? ""), rec?.decision);
  const vid = rec?.verification_id;
  check("record stored", Boolean(vid), JSON.stringify(vid));

  console.log("\n== 3. challenge (public) ==");
  let r: any = await verifier.challenge({ verificationId: vid, reason: "Evidence snapshot may be stale" });
  let rx: any = await verifier.waitForReceipt(r.txHash);
  check("challenge accepted", isExecutionSuccess(rx), executionError(rx) ?? "");
  const c1 = await verifier.getVerification(vid);
  check("status CONTESTED", c1.status === "CONTESTED", c1.status);

  console.log("\n== 4. challenge (already contested -> reject) ==");
  r = await verifier.challenge({ verificationId: vid, reason: "second dispute" });
  rx = await verifier.waitForReceipt(r.txHash);
  check("double challenge rejected", isExecutionError(rx), JSON.stringify(rx));

  console.log("\n== 5. reverify by non-owner -> reject ==");
  const attacker = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  r = await attacker.reverify({ verificationId: vid, urls: [OM_API, "https://open-meteo.com/en"] });
  rx = await attacker.waitForReceipt(r.txHash);
  check("non-owner reverify rejected", isExecutionError(rx), JSON.stringify(rx));

  console.log("\n== 6. reverify by owner -> accepted + revision history ==");
  r = await verifier.reverify({ verificationId: vid, urls: [OM_API, "https://open-meteo.com/en"] });
  rx = await verifier.waitForReceipt(r.txHash);
  check("owner reverify executed", isExecutionSuccess(rx), executionError(rx) ?? "");
  const c2 = await verifier.getVerification(vid);
  check("version bumped", c2.version >= 2, `v${c2.version}`);
  check("revision history saved", Array.isArray(c2.revisions) && c2.revisions.length >= 1, JSON.stringify(c2.revisions?.length));

  console.log("\n==== ACCEPTANCE RESULT ====");
  console.log(`PASS: ${pass} | FAIL: ${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", String(e?.message ?? e).slice(0, 200));
  process.exit(1);
});
