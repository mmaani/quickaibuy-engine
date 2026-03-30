import dotenv from "dotenv";
import { assertNonCanonicalScriptAccess } from "./lib/nonCanonicalSurfaceGuard";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  await assertNonCanonicalScriptAccess({
    scriptName: "run_profit_engine_direct.ts",
    blockedAction: "run_profit_engine_direct",
    canonicalAction: "pnpm enqueue:profit-eval",
    mutatesState: true,
  });

  const { runProfitEngine } = await import("@/lib/profit/profitEngine");
  const limit = Number(process.argv[2] || "20");
  const supplierKey = String(process.argv[3] || "").trim() || undefined;
  const result = await runProfitEngine({ limit, supplierKey });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
