import { getValidCjAccessToken } from "@/lib/suppliers/cj/auth";
import { extractTrackingNumber, getCjTrackingInfo, calculateCjFreight, calculateCjFreightTip } from "@/lib/suppliers/cj/logistics";
import { formatCjErrorForOperator } from "@/lib/suppliers/cj/errors";
import { getCjOrderDetail, listCjOrders } from "@/lib/suppliers/cj/orders";
import { getCjSettingsSummary, getCjShops } from "@/lib/suppliers/cj/settings";
import { getCjDirectProductSnapshot, queryCjProductById, queryCjStockByVid, queryCjVariantByVid, queryCjVariantsByPid, searchCjProducts } from "@/lib/suppliers/cj/products";

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function pickOrderId(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  for (const key of ["orderId", "cjOrderId", "id"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

function pickVid(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  for (const key of ["vid", "variantId", "id", "ID"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

async function main() {
  const keyword = String(process.argv[2] ?? "desk organizer").trim();
  const countryCode = String(process.env.CJ_DISCOVER_COUNTRY_CODE ?? "US").trim() || "US";
  const startWarehouseInventory = Math.max(1, Number(process.env.CJ_DISCOVER_MIN_INVENTORY ?? 10));

  const token = await getValidCjAccessToken();
  const settings = await getCjSettingsSummary();
  const shops = await getCjShops();
  const search = await searchCjProducts({ keyword, size: 3, countryCode, startWarehouseInventory });
  const first = search.products[0] ?? null;
  const pid = first?.id ? String(first.id) : null;
  const productQuery = pid ? await queryCjProductById(pid) : null;
  const snapshot = pid ? await getCjDirectProductSnapshot(pid) : null;
  const variants = pid ? await queryCjVariantsByPid(pid) : [];
  const vid = pickVid((variants[0] ?? null) as Record<string, unknown> | null) ?? clean(snapshot?.detailWrapped.data?.stanProducts?.[0]?.ID);
  const variant = vid ? await queryCjVariantByVid(vid) : null;
  const stock = vid ? await queryCjStockByVid(vid) : null;
  const inventories = Array.isArray(snapshot?.inventoryWrapped.data?.inventories) ? snapshot.inventoryWrapped.data.inventories : [];
  const startCountryCode = clean(inventories[0]?.countryCode) ?? "CN";
  const vids = (Array.isArray(snapshot?.detailWrapped.data?.stanProducts) ? snapshot.detailWrapped.data.stanProducts : [])
    .map((row) => clean(row.ID))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  const skus = (Array.isArray(snapshot?.detailWrapped.data?.stanProducts) ? snapshot.detailWrapped.data.stanProducts : [])
    .map((row) => clean(row.SKU))
    .filter((value): value is string => Boolean(value))
    .slice(0, 3);
  const freight = vids.length
    ? await calculateCjFreight({ startCountryCode, endCountryCode: "US", products: vids.map((value) => ({ quantity: 1, vid: value })) })
    : [];
  const freightTip = skus.length
    ? await calculateCjFreightTip({
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
      })
    : [];
  const orders = await listCjOrders({ pageNum: 1, pageSize: 5 });
  const orderId = pickOrderId((orders[0] ?? null) as Record<string, unknown> | null);
  const orderDetail = orderId ? await getCjOrderDetail(orderId) : null;
  const trackNumber = clean(orderDetail?.trackNumber) ?? extractTrackingNumber(orderDetail?.raw ?? null);
  const tracking = trackNumber ? await getCjTrackingInfo(trackNumber) : null;

  console.log(
    JSON.stringify(
      {
        ok: Boolean(token),
        auth: { tokenAvailable: Boolean(token) },
        settings: {
          qpsLimit: settings?.qpsLimit ?? null,
          quotaLimit: settings?.quotaLimit ?? null,
          quotaRemaining: settings?.quotaRemaining ?? null,
          operationalState: settings?.operationalState ?? null,
          sandbox: settings?.sandbox ?? null,
        },
        shops: { count: shops.length, first: shops[0] ?? null },
        product: {
          searchCount: search.products.length,
          pid,
          name: first?.nameEn ?? null,
          productQueryId: productQuery?.ID ?? null,
          cacheDetailId: snapshot?.detailWrapped.data?.ID ?? null,
        },
        variant: {
          count: variants.length,
          vid,
          variantOk: Boolean(variant),
          stockOk: Boolean(stock),
        },
        freight: {
          freightCount: freight.length,
          freightTipCount: freightTip.length,
          firstFreight: freight[0] ?? null,
          firstFreightTip: freightTip[0] ?? null,
        },
        order: {
          count: orders.length,
          orderId: orderId ?? null,
          detailOk: Boolean(orderDetail?.orderId || orderDetail?.cjOrderId || orderDetail?.orderNum),
        },
        tracking: {
          trackNumber: trackNumber ?? null,
          trackingOk: Boolean(tracking?.trackingNumber),
          tracking: tracking ?? null,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
