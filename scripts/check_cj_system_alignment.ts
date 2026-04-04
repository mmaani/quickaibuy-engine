import { getCjProofStateSummary, getCjSettingsSummary } from "@/lib/suppliers/cj";

async function main() {
  const settings = await getCjSettingsSummary();
  if (!settings) {
    throw new Error("CJ settings unavailable; cannot derive proof-state summary");
  }

  const proof = getCjProofStateSummary(settings);
  if (proof.auth !== "PROVEN") throw new Error("CJ auth proof is not established");
  if (proof.product !== "PROVEN") throw new Error("CJ product proof is not established");
  if (proof.variant !== "PROVEN") throw new Error("CJ variant proof is not established");
  if (proof.stock !== "PROVEN") throw new Error("CJ stock proof is not established");
  if (proof.freight !== "PROVEN") throw new Error("CJ freight proof is not established");
  if (proof.orderCreate !== "UNPROVEN") {
    throw new Error(`Expected CJ order-create proof to remain UNPROVEN until a disposable live proof is completed, got ${proof.orderCreate}`);
  }
  if (proof.orderDetail !== "PARTIALLY_PROVEN") {
    throw new Error(`Expected CJ order-detail proof to remain PARTIALLY_PROVEN until the full create->detail lifecycle is proven, got ${proof.orderDetail}`);
  }
  if (proof.tracking !== "UNPROVEN") {
    throw new Error(`Expected CJ tracking proof to remain UNPROVEN until a real tracking number has been validated, got ${proof.tracking}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        overall: proof.overall,
        proof,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
