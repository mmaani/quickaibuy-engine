import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
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
