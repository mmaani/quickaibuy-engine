import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel" });
dotenv.config();

async function main() {
  const { searchAliExpressByKeyword } = await import("@/lib/products/suppliers/aliexpress");
  const { searchAlibabaByKeyword } = await import("@/lib/products/suppliers/alibaba");
  const { searchCjByKeyword } = await import("@/lib/products/suppliers/cjdropshipping");
  const { searchTemuByKeyword } = await import("@/lib/products/suppliers/temu");
  const { supplierProductToRawInsert } = await import("@/lib/products/supplierSnapshots");
  const { insertProductRawReturningId } = await import("@/lib/db/productsRaw");
  const { handleMarketplaceScanJob } = await import("@/lib/jobs/marketplaceScan");
  const { handleMatchProductsJob } = await import("@/lib/jobs/matchProducts");
  const { runProfitEngine } = await import("@/lib/profit/profitEngine");

  const keywords = [
    "desktop perforated board storage box",
    "desk organizer pen holder",
    "wireless charging led night light",
    "bedside lamp",
    "ambient desk lamp",
    "magnetic car phone mount",
    "mini portable fan",
  ];

  const providers = [
    { key: "aliexpress", search: searchAliExpressByKeyword },
    { key: "alibaba", search: searchAlibabaByKeyword },
    { key: "cjdropshipping", search: searchCjByKeyword },
    { key: "temu", search: searchTemuByKeyword },
  ] as const;

  const discovered: Array<Record<string, unknown>> = [];
  const providerSummary = new Map<string, {
    attempted: number;
    fetched: number;
    kept: number;
    persisted: number;
    shippingUsable: number;
    inStock: number;
  }>();

  for (const keyword of keywords) {
    for (const provider of providers) {
      const summary = providerSummary.get(provider.key) ?? {
        attempted: 0,
        fetched: 0,
        kept: 0,
        persisted: 0,
        shippingUsable: 0,
        inStock: 0,
      };
      summary.attempted++;
      const rows = await provider.search(keyword, 8);
      summary.fetched += rows.length;
      for (const row of rows) {
        const shippingSignal = String(row.raw?.shippingSignal ?? "").trim().toUpperCase();
        const shippingConfidence =
          typeof row.raw?.shippingConfidence === "number" ? row.raw.shippingConfidence : null;
        const price = row.price != null ? Number(row.price) : null;
        const imageCount = Array.isArray(row.images) ? row.images.length : 0;
        const shippingUsable =
          (shippingSignal === "DIRECT" || shippingSignal === "PARTIAL" || shippingSignal === "INFERRED") &&
          (shippingConfidence == null || shippingConfidence >= 0.45);
        if (shippingUsable) summary.shippingUsable++;
        if (row.availabilitySignal === "IN_STOCK") summary.inStock++;
        const shouldKeep =
          row.availabilitySignal === "IN_STOCK" &&
          row.snapshotQuality !== "LOW" &&
          imageCount >= 3 &&
          shippingUsable &&
          (price == null || price <= 40);

        if (!shouldKeep) continue;
        summary.kept++;

        const insertRow = supplierProductToRawInsert(row);
        const productRawId = await insertProductRawReturningId(insertRow);
        summary.persisted++;
        const scan = await handleMarketplaceScanJob({
          limit: 25,
          productRawId,
          platform: "ebay",
        });
        const match = await handleMatchProductsJob({
          limit: 25,
          productRawId,
        });
        const profit = await runProfitEngine({
          limit: 25,
          supplierKey: insertRow.supplierKey,
          supplierProductId: String(insertRow.supplierProductId),
          marketplaceKey: "ebay",
        });

        discovered.push({
          keyword,
          provider: provider.key,
          supplierProductId: row.supplierProductId,
          title: row.title,
          price: row.price,
          availabilitySignal: row.availabilitySignal,
          shippingSignal,
          shippingConfidence,
          productRawId,
          scan,
          match,
          profit,
        });
      }
      providerSummary.set(provider.key, summary);
    }
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        keywords,
        discoveredCount: discovered.length,
        providerSummary: Array.from(providerSummary.entries()).map(([provider, summary]) => ({
          provider,
          ...summary,
        })),
        discovered,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
