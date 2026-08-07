import { Verifier } from "../src/index";

const CONTRACT = process.argv[2] || "0x8934dfd22A3CF8082B443AF80786da2EFE646f08";

async function main() {
  const v = new Verifier({ contractAddress: CONTRACT });
  console.log("Contract:", CONTRACT);
  const ids = await v.getPolicyIds();
  console.log("policy_ids:", JSON.stringify(ids));
  const expected = [
    "grant-v1",
    "dao-proposal-v1",
    "company-status-v1",
    "insurance-claim-v1",
    "service-status-v1",
  ];
  if (ids.length !== 5 || !expected.every((x) => ids.includes(x))) {
    throw new Error("expected exactly 5 built-in policies, no extras");
  }
  console.log("EXACTLY 5 BUILT-IN POLICIES ✓ (no register_policy / no extras)");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
