import { checkOrderAutomationSchema } from "./lib/orderAutomationSchemaCheck";

async function main() {
  const result = await checkOrderAutomationSchema();
  console.log(JSON.stringify(result, null, 2));

  if (!result.schemaComplete) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
