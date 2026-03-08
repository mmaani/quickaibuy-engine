import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { runListingExecution } = await import("../src/workers/listingExecute.worker");
  const maxPerDay = Number(process.argv[2] || "10");

  const result = await runListingExecution(maxPerDay);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
