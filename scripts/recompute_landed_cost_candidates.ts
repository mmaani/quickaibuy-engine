import { runProfitEngine } from "@/lib/profit/profitEngine";

async function main() {
  const limitArg = process.argv.find((entry) => entry.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : 200;

  const result = await runProfitEngine({ limit });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("recompute_landed_cost_candidates failed", error);
  process.exit(1);
});
