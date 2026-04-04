import {
  calculateCjFreight,
  calculateCjFreightTip,
  formatCjErrorForOperator,
  getCjDirectProductSnapshot,
  searchCjProducts,
} from "@/lib/suppliers/cj";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

async function main() {
  const pidArg = String(process.argv[2] ?? "").trim();
  const keyword = String(process.argv[3] ?? "desk organizer").trim();
  const countryCode = String(process.env.CJ_DISCOVER_COUNTRY_CODE ?? "US").trim() || "US";
  const startWarehouseInventory = Math.max(1, Number(process.env.CJ_DISCOVER_MIN_INVENTORY ?? 10));

  const pid =
    pidArg ||
    String(
      (
        await searchCjProducts({
          keyword,
          size: 1,
          countryCode,
          startWarehouseInventory,
        })
      ).products[0]?.id ?? ""
    ).trim();

  if (!pid) throw new Error("No CJ product id available for freight validation");

  const snapshot = await getCjDirectProductSnapshot(pid);
  const detail = snapshot.detailWrapped.data;
  const inventory = snapshot.inventoryWrapped.data ?? {};
  const inventories = Array.isArray(inventory.inventories) ? inventory.inventories : [];
  const startCountryCode = cleanString(inventories[0]?.countryCode) ?? "CN";
  const vids = (Array.isArray(detail?.stanProducts) ? detail.stanProducts : [])
    .map((variant) => cleanString(variant.ID))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  const skus = (Array.isArray(detail?.stanProducts) ? detail.stanProducts : [])
    .map((variant) => cleanString(variant.SKU))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);

  if (!vids.length || !skus.length) throw new Error(`No CJ variants available for freight validation on ${pid}`);

  const [freight, freightTip] = await Promise.all([
    calculateCjFreight({
      startCountryCode,
      endCountryCode: "US",
      products: vids.map((vid) => ({ quantity: 1, vid })),
    }),
    calculateCjFreightTip({
      reqDTOS: [
        {
          srcAreaCode: startCountryCode,
          destAreaCode: "US",
          skuList: skus,
          freightTrialSkuList: skus.map((sku, index) => ({ sku, vid: vids[index] ?? undefined, skuQuantity: 1 })),
          weight: 200,
          wrapWeight: 0,
          volume: 1000,
          productProp: ["COMMON"],
          platforms: ["Shopify"],
        },
      ],
    }),
  ]);

  const ok = freight.length > 0 || freightTip.length > 0;
  console.log(
    JSON.stringify(
      {
        ok,
        pid,
        startCountryCode,
        freightQuoteCount: freight.length,
        freightTipQuoteCount: freightTip.length,
        freightFirst: freight[0] ?? null,
        freightTipFirst: freightTip[0] ?? null,
      },
      null,
      2
    )
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
