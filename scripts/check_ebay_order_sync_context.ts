import dotenv from "dotenv";
import {
  getEbayPublishEnvValidation,
  getEbaySellAccessToken,
  getInventoryLocations,
} from "@/lib/marketplaces/ebayPublish";

dotenv.config({ path: ".env.local" });
dotenv.config();

type OrderWindowSummary = {
  lookbackDays: number;
  status: number;
  ok: boolean;
  ordersLength: number;
  firstOrderId: string | null;
  next: string | null;
};

async function fetchOrderWindowSummary(input: {
  token: string;
  marketplaceId: string;
  lookbackDays: number;
  limit?: number;
}): Promise<OrderWindowSummary> {
  const startTs = new Date(Date.now() - input.lookbackDays * 24 * 60 * 60 * 1000).toISOString();
  const filter = `creationdate:[${startTs}..]`;
  const url = `https://api.ebay.com/sell/fulfillment/v1/order?limit=${Math.max(
    1,
    Math.min(100, Number(input.limit ?? 100))
  )}&filter=${encodeURIComponent(filter)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": input.marketplaceId.toUpperCase(),
    },
  });

  const text = await resp.text();
  const body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  const rawOrders = Array.isArray(body.orders) ? body.orders : [];
  const firstOrder = (rawOrders[0] ?? null) as Record<string, unknown> | null;

  return {
    lookbackDays: input.lookbackDays,
    status: resp.status,
    ok: resp.ok,
    ordersLength: rawOrders.length,
    firstOrderId:
      typeof firstOrder?.orderId === "string"
        ? firstOrder.orderId
        : typeof firstOrder?.legacyOrderId === "string"
          ? firstOrder.legacyOrderId
          : null,
    next: typeof body.next === "string" ? body.next : null,
  };
}

async function main() {
  const validation = getEbayPublishEnvValidation();
  if (!validation.config) {
    console.log(
      JSON.stringify(
        {
          status: "FAILED",
          reason: "eBay publish config is invalid",
          errors: validation.errors,
          redacted: validation.redacted,
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  const config = validation.config;
  const token = await getEbaySellAccessToken(config);
  const inventoryLocations = await getInventoryLocations(token, config);
  const orderWindows = await Promise.all(
    [7, 14, 30, 365].map((lookbackDays) =>
      fetchOrderWindowSummary({
        token,
        marketplaceId: config.marketplaceId,
        lookbackDays,
      })
    )
  );

  console.log(
    JSON.stringify(
      {
        status: "OK",
        marketplaceId: config.marketplaceId,
        websiteUrl: config.websiteUrl,
        merchantLocationKey: config.merchantLocationKey,
        inventoryLocations,
        orderWindows,
        interpretation:
          orderWindows.every((window) => window.ok && window.ordersLength === 0)
            ? "Connected seller context is valid, but no eBay fulfillment orders were returned in the checked windows."
            : "At least one checked window returned eBay fulfillment orders for this seller context.",
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.log(
    JSON.stringify(
      {
        status: "FAILED",
        reason: error instanceof Error ? error.message : String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
