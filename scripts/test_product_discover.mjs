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

    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = val;
    }
  }

  return true;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

if (!("ENABLE_STUB_PRODUCT_DISCOVER" in process.env)) {
  process.env.ENABLE_STUB_PRODUCT_DISCOVER = "true";
}

const candidateId = process.argv[2];

if (!candidateId) {
  console.error("Usage: node --import tsx scripts/test_product_discover.mjs <candidateId>");
  process.exit(1);
}

const mod = await import("../src/lib/products/discoverProducts.ts");
const discoverProductsForCandidate =
  mod.discoverProductsForCandidate ??
  mod.default?.discoverProductsForCandidate ??
  mod["module.exports"]?.discoverProductsForCandidate;

if (typeof discoverProductsForCandidate !== "function") {
  throw new Error("discoverProductsForCandidate export not found");
}

const result = await discoverProductsForCandidate(candidateId);

console.log(JSON.stringify(result, null, 2));
