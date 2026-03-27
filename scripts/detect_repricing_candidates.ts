import { runShippingRepricingMonitor } from "@/lib/profit/shippingRepricing";

async function main() {
  const apply = process.argv.includes("--apply");
  const limitArg = process.argv.find((entry) => entry.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;

  const result = await runShippingRepricingMonitor({
    apply,
    limit,
    actorId: "scripts.detect_repricing_candidates",
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("detect_repricing_candidates failed", error);
  process.exit(1);
});
