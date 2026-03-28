import { backfillCanonicalCustomers } from "@/lib/orders/customerIntelligence";

async function main() {
  const limit = Number(process.argv[2] ?? "1000");
  const result = await backfillCanonicalCustomers({ limit });
  console.log(
    JSON.stringify(
      {
        ok: true,
        processed: result.processed,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
