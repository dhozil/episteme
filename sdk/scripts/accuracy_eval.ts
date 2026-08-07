import { Verifier, isExecutionSuccess } from "../src/index";
import { createAccount } from "genlayer-js";

const CONTRACT = process.argv[2] || "0x8934dfd22A3CF8082B443AF80786da2EFE646f08";
const OM_API =
  "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto";

interface Case {
  label: string;
  question: string;
  policy: string;
  urls: string[];
  expect: "positive" | "negative";
}

const CASES: Case[] = [
  {
    label: "service positive",
    question: "Is the open-meteo weather API reachable and returning valid, current data right now?",
    policy: "service-status-v1",
    urls: [OM_API, "https://open-meteo.com/en"],
    expect: "positive",
  },
  {
    label: "service negative",
    question: "Is the open-meteo nonexistent-endpoint-xyz API reachable and returning valid, current data right now?",
    policy: "service-status-v1",
    urls: [
      "https://api.open-meteo.com/v1/nonexistent-endpoint-xyz",
      "https://open-meteo.com/definitely-not-a-real-page-xyz",
    ],
    expect: "negative",
  },
  {
    label: "company positive",
    question: "Is the open-meteo weather service actively operating?",
    policy: "company-status-v1",
    urls: [OM_API, "https://open-meteo.com/en"],
    expect: "positive",
  },
  {
    label: "company negative",
    question: "Is the nonexistent-open-meteo-xyz weather service actively operating?",
    policy: "company-status-v1",
    urls: [
      "https://api.open-meteo.com/v1/nonexistent-endpoint-xyz",
      "https://open-meteo.com/definitely-not-a-real-page-xyz",
    ],
    expect: "negative",
  },
];

const VOTE: Record<string, string> = { "1": "AGREE", "2": "DISAGREE", "3": "TIMEOUT", "0": "NOT_VOTED" };

function isCorrect(decision: string, expect: "positive" | "negative"): boolean {
  const d = decision.toUpperCase();
  if (expect === "positive") return d === "PASS" || d === "NEEDS_REVIEW";
  return d === "FAIL" || d === "INSUFFICIENT_EVIDENCE";
}

async function main() {
  const verifier = new Verifier({ contractAddress: CONTRACT, account: createAccount() });
  console.log("Contract:", CONTRACT);
  console.log("Evaluating", CASES.length, "cases against ground truth\n");

  let correct = 0;
  let consensusAgree = 0;
  const rows: string[] = [];

  for (const c of CASES) {
    try {
      const { txHash, executed, verificationId } = await verifier.verifyAndWait({ question: c.question, policyId: c.policy, urls: c.urls });
      const tx = await verifier.getTransaction(txHash);
      const resultName = tx?.result_name ?? "?";
      const votes = ((tx?.last_round?.validator_votes) ?? []).map((v: string) => VOTE[String(v)] ?? String(v));
      const rec = verificationId ? await verifier.getVerification(verificationId) : null;
      const ok = executed && isCorrect(rec?.decision ?? "", c.expect);
      if (ok) correct++;
      if (executed && resultName === "MAJORITY_AGREE") consensusAgree++;
      rows.push(
        `[${ok ? "CORRECT" : "WRONG  "}] ${c.label} | ${rec?.decision ?? "?"} (expect ${c.expect}) | ` +
          `conf ${rec?.confidence ?? "?"}% | sources ${rec?.evidence?.summary?.sources_ok ?? "?"}/${rec?.evidence?.summary?.sources_fetched ?? "?"} | ` +
          `consensus ${resultName} | votes ${JSON.stringify(votes)}`,
      );
    } catch (e: any) {
      rows.push(`[SKIP  ] ${c.label} | error ${String(e?.message ?? e).slice(0, 140)}`);
    }
  }

  console.log(rows.join("\n"));
  console.log(`\nACCURACY: ${correct}/${CASES.length} = ${CASES.length ? Math.round((correct / CASES.length) * 100) : 0}%`);
  console.log(`CONSENSUS MAJORITY_AGREE: ${consensusAgree}/${CASES.length}`);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
