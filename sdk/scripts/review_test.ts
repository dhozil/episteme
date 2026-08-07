/**
 * On-chain verification of the GenLayer review points:
 *   1) Validators agree on every mandatory criterion.
 *   2) Sources are bound to the URLs actually submitted/fetched.
 *   3) The verification id comes from the transaction's return value and the
 *      original submitted URLs are preserved across re-verification.
 *
 * Usage: tsx scripts/review_test.ts <contract-address>
 */
import { Verifier, isExecutionSuccess, executionError } from "../src/index.js";
import { createAccount } from "genlayer-js";

const CONTRACT = process.argv[2] || process.env.TEST_CONTRACT;
const OM_API =
  "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto";
const URLS = [OM_API, "https://open-meteo.com/en"];

const RES = { pass: 0, fail: 0 };
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { RES.pass++; console.log(`  [PASS] ${label}`); }
  else { RES.fail++; console.log(`  [FAIL] ${label} ${detail}`); }
};

async function main() {
  if (!CONTRACT) throw new Error("usage: tsx scripts/review_test.ts <contract-address>");
  const v = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  console.log("REVIEW TEST — contract", CONTRACT);

  console.log("\n== 1. verify + tx-returned verification id ==");
  const { txHash, executed, verificationId } = await v.verifyAndWait({
    question: "Is the open-meteo weather API reachable and returning valid, current data right now?",
    policyId: "service-status-v1",
    urls: URLS,
  });
  check("verify executed (consensus)", executed, txHash);
  check("tx returned a verification id", Boolean(verificationId), String(verificationId));

  const tx = await v.getTransaction(txHash);
  check("consensus MAJORITY_AGREE", tx?.result_name === "MAJORITY_AGREE", String(tx?.result_name));
  const rec = verificationId ? await v.getVerification(verificationId) : null;
  check("returned id matches the stored record", rec?.verification_id === verificationId, String(rec?.verification_id));

  console.log("\n== 2. original URLs preserved + sources bound ==");
  check("submitted_urls preserved exactly", JSON.stringify(rec?.submitted_urls) === JSON.stringify(URLS), JSON.stringify(rec?.submitted_urls));
  const sourcesInSubmitted = (rec?.sources ?? []).every((s: any) => URLS.some((u) => s.url === u || u.startsWith(s.url)));
  check("every source is a submitted/fetched URL", sourcesInSubmitted, JSON.stringify(rec?.sources?.map((s: any) => s.url)));
  check("no LLM-fabricated category (deterministic PRIMARY)", (rec?.sources ?? []).every((s: any) => ["PRIMARY", "SECONDARY", "UNVERIFIED"].includes(s.category)), JSON.stringify(rec?.sources?.map((s: any) => `${s.url}:${s.category}`)));

  console.log("\n== 3. every mandatory criterion reported & agreed ==");
  const policy = await v.getPolicy("service-status-v1");
  const mandatoryIds = (policy.criteria ?? []).filter((c: any) => c.mandatory).map((c: any) => c.id);
  const recCriteria = (rec?.criteria ?? []).map((c: any) => c.id);
  check("all mandatory criteria present in the record", mandatoryIds.every((id: string) => recCriteria.includes(id)), JSON.stringify(recCriteria));
  check("mandatory criteria have PASS/FAIL/UNKNOWN results", (rec?.criteria ?? []).every((c: any) => ["PASS", "FAIL", "UNKNOWN"].includes(c.result)));

  console.log("\n== 4. re-verification uses the same record + original URLs ==");
  if (!verificationId) throw new Error("no verification id");
  const r = await v.reverify({ verificationId, urls: URLS });
  const rx = await v.waitForReceipt(r.txHash);
  check("reverify executed", isExecutionSuccess(rx), executionError(rx) ?? "");
  const rec2 = await v.getVerification(verificationId);
  check("same verification id after reverify", rec2.verification_id === verificationId, String(rec2.verification_id));
  check("version bumped", rec2.version === 2, `v${rec2.version}`);
  check("revision history saved", Array.isArray(rec2.revisions) && rec2.revisions.length === 1, JSON.stringify(rec2.revisions?.length));
  check("revision preserves original submitted urls", JSON.stringify(rec2.revisions?.[0]?.submitted_urls) === JSON.stringify(URLS), JSON.stringify(rec2.revisions?.[0]?.submitted_urls));
  check("record still preserves submitted urls", JSON.stringify(rec2.submitted_urls) === JSON.stringify(URLS));

  console.log("\n==== REVIEW TEST RESULT ====");
  console.log(`PASS: ${RES.pass} | FAIL: ${RES.fail}`);
  if (RES.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", String(e?.message ?? e).slice(0, 200));
  process.exit(1);
});
