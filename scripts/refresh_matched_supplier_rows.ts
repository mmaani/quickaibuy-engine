import { loadRuntimeEnv } from "@/lib/runtimeEnv";

loadRuntimeEnv();

async function main() {
  const supplierKey = String(process.argv[2] ?? "").trim() || undefined;
  const supplierProductId = String(process.argv[3] ?? "").trim() || undefined;
  const limit = Number(process.argv[4] ?? "10");

  const { refreshMatchedSupplierRows } = await import("@/lib/products/refreshMatchedSupplierRows");
  const result = await refreshMatchedSupplierRows({
    supplierKey,
    supplierProductId,
    limit,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
