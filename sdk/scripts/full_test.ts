import { Verifier, isExecutionSuccess, isExecutionError, executionError } from "../src/index";
import { createAccount } from "genlayer-js";

const CONTRACT = process.argv[2] || process.env.TEST_CONTRACT;
const OM_API =
  "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto";
const VOTE: Record<string, string> = { "1": "AGREE", "2": "DISAGREE", "3": "TIMEOUT", "0": "NOT_VOTED" };

const RES = { pass: 0, fail: 0 };
const check = (label: string, ok: boolean, detail = "") => {
  if (ok) { RES.pass++; console.log(`  [PASS] ${label}`); }
  else { RES.fail++; console.log(`  [FAIL] ${label} ${detail}`); }
};

async function submitExpect(verifier: Verifier, fn: () => Promise<any>, label: string, expectError: boolean) {
  const { txHash } = await fn();
  const rx = await verifier.waitForReceipt(txHash);
  const executed = isExecutionSuccess(rx);
  if (expectError) check(`${label} -> rejected`, isExecutionError(rx) || !executed, JSON.stringify(rx));
  else check(`${label} -> executed`, executed, executionError(rx) ?? "");
}

async function verifyClass(verifier: Verifier, label: string, question: string, policy: string, urls: string[], expect: "positive" | "negative"): Promise<string | null> {
  try {
    const { txHash, executed, verificationId } = await verifier.verifyAndWait({ question, policyId: policy, urls });
    const tx = await verifier.getTransaction(txHash);
    const resultName = tx?.result_name ?? "?";
    const votes = ((tx?.last_round?.validator_votes) ?? []).map((v: string) => VOTE[String(v)] ?? String(v));
    const rec = verificationId ? await verifier.getVerification(verificationId) : undefined;
    const d = rec?.decision?.toUpperCase() ?? "?";
    const ok = executed && (expect === "positive" ? d === "PASS" || d === "NEEDS_REVIEW" : d === "FAIL" || d === "INSUFFICIENT_EVIDENCE");
    check(
      `${label} -> ${rec?.decision ?? "?"} (expect ${expect})`,
      ok,
      `conf ${rec?.confidence ?? "?"}% sources ${rec?.evidence?.summary?.sources_ok ?? "?"}/${rec?.evidence?.summary?.sources_fetched ?? "?"} consensus ${resultName} votes ${JSON.stringify(votes)}`,
    );
    return verificationId;
  } catch (e: any) {
    check(`${label}`, false, String(e?.message ?? e).slice(0, 120));
    return null;
  }
}

async function main() {
  if (!CONTRACT) throw new Error("usage: tsx scripts/full_test.ts <contract-address>");
  const verifier = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  const attacker = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  console.log("FULL TEST — contract", CONTRACT);

  console.log("\n== A. Reads ==");
  const stats = await verifier.getStats();
  check("get_stats", stats?.policies_count === 5, JSON.stringify(stats));
  const ids = await verifier.getPolicyIds();
  check("5 built-in policies", ids.length === 5 && ["grant-v1", "dao-proposal-v1", "company-status-v1", "insurance-claim-v1", "service-status-v1"].every((x) => ids.includes(x)), JSON.stringify(ids));
  const ins = await verifier.getPolicy("insurance-claim-v1");
  check("insurance hardened (allowed/required/parties)", !!ins.allowed_origins && !!ins.required_origin && ins.dispute_mode === "parties", JSON.stringify(ins));

  console.log("\n== B. Input / policy guardrails (should reject) ==");
  await submitExpect(verifier, () => verifier.verify({ question: "q", policyId: "nope", urls: [OM_API] }), "unknown policy", true);
  await submitExpect(verifier, () => verifier.verify({ question: "   ", policyId: "grant-v1", urls: [OM_API] }), "empty question", true);
  await submitExpect(verifier, () => verifier.verify({ question: "x".repeat(1001), policyId: "grant-v1", urls: [OM_API] }), "long question", true);
  await submitExpect(verifier, () => verifier.verify({ question: "q", policyId: "grant-v1", urls: [] }), "no urls", true);
  await submitExpect(verifier, () => verifier.verify({ question: "q", policyId: "grant-v1", urls: ["https://evil-example.com/fake"] }), "disallowed origin", true);
  await submitExpect(verifier, () => verifier.verify({ question: "q", policyId: "insurance-claim-v1", urls: ["https://www.flightaware.com/live/flight/BAW123"] }), "insurance missing required origin", true);
  await submitExpect(verifier, () => verifier.verify({ question: "q", policyId: "grant-v1", urls: ["https://" + "a".repeat(400)] }), "url too long", true);

  console.log("\n== C. Verifications across policies ==");
  await verifyClass(verifier, "service positive", "Is the open-meteo weather API reachable and returning valid, current data right now?", "service-status-v1", [OM_API, "https://open-meteo.com/en"], "positive");
  await verifyClass(verifier, "service negative", "Is the open-meteo nonexistent-xyz API reachable right now?", "service-status-v1", ["https://api.open-meteo.com/v1/nonexistent-xyz", "https://open-meteo.com/not-a-real-page-xyz"], "negative");
  await verifyClass(verifier, "company positive", "Is the open-meteo weather service actively operating?", "company-status-v1", [OM_API, "https://open-meteo.com/en"], "positive");
  await verifyClass(verifier, "company negative", "Is the nonexistent-company-xyz service actively operating?", "company-status-v1", ["https://api.open-meteo.com/v1/nonexistent-xyz", "https://open-meteo.com/not-a-real-page-xyz"], "negative");
  await verifyClass(verifier, "grant positive", "Is the genlayer-py repository open-source and actively maintained?", "grant-v1", ["https://github.com/genlayerlabs/genlayer-py", "https://docs.genlayer.com/developers"], "positive");
  await verifyClass(verifier, "dao positive", "Is the Uniswap DAO UNIfication proposal active and substantiated for treasury funding?", "dao-proposal-v1", ["https://gov.uniswap.org/t/unification-proposal/25881", "https://gov.uniswap.org/t/temp-check-activate-v4-protocol-fees/26162"], "positive");

  console.log("\n== D. Dispute / versioning ==");
  // Owner-scoped list avoids picking another account's concurrently-created record.
  const vids = await verifier.getMyVerifications();
  const vid = vids[vids.length - 1];
  check("got a record", Boolean(vid), JSON.stringify(vids));
  if (vid) {
    await submitExpect(verifier, () => verifier.challenge({ verificationId: vid, reason: "Snapshot may be stale" }), "challenge", false);
    const c1 = await verifier.getVerification(vid);
    check("status CONTESTED", c1.status === "CONTESTED", c1.status);
    await submitExpect(verifier, () => verifier.challenge({ verificationId: vid, reason: "second" }), "double challenge", true);
    await submitExpect(attacker, () => attacker.reverify({ verificationId: vid, urls: [OM_API, "https://open-meteo.com/en"] }), "non-owner reverify", true);
    await submitExpect(verifier, () => verifier.reverify({ verificationId: vid, urls: [OM_API, "https://open-meteo.com/en"] }), "owner reverify", false);
    const c2 = await verifier.getVerification(vid);
    check("version bumped", c2.version >= 2, `v${c2.version}`);
    check("revision history", Array.isArray(c2.revisions) && c2.revisions.length >= 1, JSON.stringify(c2.revisions?.length));
    check("summary", typeof (await verifier.getVerificationSummary(vid)) === "string");
  }

  console.log("\n==== FULL TEST RESULT ====");
  console.log(`PASS: ${RES.pass} | FAIL: ${RES.fail}`);
  if (RES.fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", String(e?.message ?? e).slice(0, 200));
  process.exit(1);
});
