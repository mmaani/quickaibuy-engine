import dotenv from "dotenv";
import { assertNonCanonicalScriptAccess } from "./lib/nonCanonicalSurfaceGuard";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  await assertNonCanonicalScriptAccess({
    scriptName: "run_product_matcher_direct.ts",
    blockedAction: "run_product_matcher_direct",
    canonicalAction: "POST /api/admin/pipeline/run-match-products or /admin/control quick action",
    mutatesState: true,
  });

  const limitArg = Number(process.argv[2] || "20");
  const productRawIdArg = process.argv[3] || undefined;

  const { runEbayMatches } = await import("@/lib/matches/ebayMatchEngine");

  const result = await runEbayMatches({
    limit: limitArg,
    productRawId: productRawIdArg,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});