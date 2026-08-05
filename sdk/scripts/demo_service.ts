import { Verifier, isExecutionSuccess } from "../src/index";

const CONTRACT = process.argv[2] || "0xE5C9A821b0Fa27Fe8d8DE0e74a55C0fdc17760ff";

async function main() {
  const v = new Verifier({ contractAddress: CONTRACT });
  console.log("Contract:", CONTRACT);
  console.log("policy: service-status-v1, sources: open-meteo");

  const { txHash, executed } = await v.verifyAndWait({
    question: "Is the open-meteo weather API reachable and returning valid, current data right now?",
    policyId: "service-status-v1",
    urls: [
      "https://api.open-meteo.com/v1/forecast?latitude=-6.2088&longitude=106.8456&current=temperature_2m,relative_humidity_2m&timezone=auto",
      "https://open-meteo.com/en",
    ],
  });
  console.log("executed:", executed, "tx:", txHash);

  const ids = await v.getMyVerifications();
  const rec = await v.getVerification(ids[ids.length - 1]);
  console.log("id:", rec.verification_id, "| decision:", rec.decision, "| status:", rec.status, "| confidence:", rec.confidence, "%");
  console.log("criteria:", rec.criteria.map((c) => `${c.id}:${c.result}`).join(" "));
  console.log("sources_ok:", rec.evidence.summary.sources_ok, "/", rec.evidence.summary.sources_fetched, "| primary:", rec.evidence.summary.primary_source, "| rules:", rec.evidence.summary.rules_satisfied);
  console.log("challenges:", rec.challenges.length);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
