import { getCjAuthSnapshot, getCjSettingsSummary, searchCjProducts } from "@/lib/suppliers/cj";

const keyword = String(process.argv[2] ?? "desk organizer").trim();
const auth = getCjAuthSnapshot();
const settings = await getCjSettingsSummary().catch(() => null);
const search = await searchCjProducts({
  keyword,
  size: 3,
  countryCode: String(process.env.CJ_DISCOVER_COUNTRY_CODE ?? "US").trim() || "US",
  startWarehouseInventory: Math.max(1, Number(process.env.CJ_DISCOVER_MIN_INVENTORY ?? 10)),
});

console.log(
  JSON.stringify(
    {
      ok: auth.hasApiKey && Boolean(search.wrapped),
      keyword,
      auth: {
        hasApiKey: auth.hasApiKey,
        tokenFresh: auth.tokenFresh,
      },
      settings,
      resultCount: search.products.length,
      firstProductId: search.products[0]?.id ?? null,
    },
    null,
    2
  )
);

if (!auth.hasApiKey || !search.wrapped) process.exitCode = 1;
