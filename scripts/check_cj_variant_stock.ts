import {
  formatCjErrorForOperator,
  queryCjProductById,
  queryCjStockByVid,
  queryCjVariantByVid,
  queryCjVariantsByPid,
  searchCjProducts,
} from "@/lib/suppliers/cj";

function pickVid(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  for (const key of ["vid", "variantId", "id", "ID"]) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
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

  if (!pid) throw new Error("No CJ product id available for variant/stock validation");

  const detail = await queryCjProductById(pid);
  const variants = await queryCjVariantsByPid(pid);
  const firstVariant = (variants[0] ?? null) as Record<string, unknown> | null;
  const vid = pickVid(firstVariant) ?? (typeof detail?.stanProducts?.[0]?.ID === "string" ? detail.stanProducts[0].ID : null);
  if (!vid) throw new Error(`No CJ variant id available for product ${pid}`);

  const variant = await queryCjVariantByVid(vid);
  const stock = await queryCjStockByVid(vid);
  const ok = Boolean(variant && stock);

  console.log(JSON.stringify({ ok, pid, variantCount: variants.length, vid, variant, stock }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
