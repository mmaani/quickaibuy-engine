import "dotenv/config";
import { runSupplierDiscover } from "@/lib/jobs/supplierDiscover";

async function main() {
  const result = await runSupplierDiscover(5);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
