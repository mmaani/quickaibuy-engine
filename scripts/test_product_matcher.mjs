import fs from "fs";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
  return true;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

const { matchSupplierProductsToMarketplaceListings } = await import("../src/lib/matching/productMatcher.ts");

const result = await matchSupplierProductsToMarketplaceListings({
  supplierLimit: Number(process.argv[2] ?? 100),
  marketplaceLimit: Number(process.argv[3] ?? 500),
  minConfidence: Number(process.argv[4] ?? 0.7),
});

console.log(JSON.stringify(result, null, 2));
