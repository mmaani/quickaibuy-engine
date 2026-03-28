import {
  getEbayPublishEnvValidation,
  getEbaySellAccessToken,
} from "@/lib/marketplaces/ebayPublish";
import { normalizeOrderMarketplace } from "./statuses";

type EbayMoney = {
  value?: string | number;
  currency?: string;
};

type EbayLineItem = {
  lineItemId?: string;
  legacyItemId?: string;
  itemId?: string;
  sku?: string;
  quantity?: number;
  lineItemCost?: EbayMoney;
  total?: EbayMoney;
};

type EbayOrder = {
  orderId?: string;
  legacyOrderId?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderFulfillmentStatus?: string;
  buyer?: {
    username?: string;
    registrationAddress?: { fullName?: string; countryCode?: string };
  };
  pricingSummary?: {
    total?: EbayMoney;
  };
  fulfillmentStartInstructions?: Array<{
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: {
          countryCode?: string;
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          county?: string;
        };
        primaryPhone?: {
          phoneNumber?: string;
        };
        email?: string;
      };
    };
  }>;
  lineItems?: EbayLineItem[];
};

type EbayOrderListResponse = {
  orders?: EbayOrder[];
};

export type NormalizedEbayOrderItem = {
  marketplaceOrderItemId: string | null;
  listingExternalId: string | null;
  quantity: number;
  itemPrice: number | null;
};

export type NormalizedEbayOrder = {
  marketplace: "ebay";
  marketplaceOrderId: string;
  buyerUsername: string | null;
  buyerName: string | null;
  buyerCountry: string | null;
  shippingAddress: {
    countryCode: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    stateOrProvince: string | null;
    postalCode: string | null;
    county: string | null;
  } | null;
  buyerPhone: string | null;
  buyerEmail: string | null;
  totalPrice: number | null;
  currency: string | null;
  createdAt: Date;
  sourceStatus: string | null;
  lineItems: NormalizedEbayOrderItem[];
};

export type FetchEbayOrdersResult = {
  fetchedCount: number;
  normalizedCount: number;
  orders: NormalizedEbayOrder[];
  lookbackHours: number;
  limit: number;
};

function logOrderSyncDebug(event: string, payload: Record<string, unknown>) {
  // TEMPORARY DIAGNOSTIC: enable with ORDER_SYNC_DEBUG=1 while investigating zero-fetch behavior.
  if (process.env.ORDER_SYNC_DEBUG !== "1") return;
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "ebay.order_sync",
      event,
      ...payload,
    })
  );
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toDateOrNow(value: string | null): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeLineItem(item: EbayLineItem): NormalizedEbayOrderItem {
  return {
    marketplaceOrderItemId: cleanString(item.lineItemId),
    listingExternalId:
      cleanString(item.legacyItemId) ??
      cleanString(item.itemId) ??
      cleanString(item.sku),
    quantity: Math.max(1, Math.trunc(toNumber(item.quantity) ?? 1)),
    itemPrice: toNumber(item.lineItemCost?.value ?? item.total?.value),
  };
}

function normalizeOrder(order: EbayOrder): NormalizedEbayOrder | null {
  const marketplaceOrderId = cleanString(order.orderId) ?? cleanString(order.legacyOrderId);
  if (!marketplaceOrderId) return null;

  const shippingStep = order.fulfillmentStartInstructions?.[0]?.shippingStep;
  const buyerName =
    cleanString(shippingStep?.shipTo?.fullName) ??
    cleanString(order.buyer?.registrationAddress?.fullName) ??
    cleanString(order.buyer?.username);
  const buyerUsername = cleanString(order.buyer?.username);
  const buyerCountry =
    cleanString(shippingStep?.shipTo?.contactAddress?.countryCode) ??
    cleanString(order.buyer?.registrationAddress?.countryCode);
  const shippingAddress = shippingStep?.shipTo?.contactAddress
    ? {
        countryCode: cleanString(shippingStep.shipTo.contactAddress.countryCode),
        addressLine1: cleanString(shippingStep.shipTo.contactAddress.addressLine1),
        addressLine2: cleanString(shippingStep.shipTo.contactAddress.addressLine2),
        city: cleanString(shippingStep.shipTo.contactAddress.city),
        stateOrProvince: cleanString(shippingStep.shipTo.contactAddress.stateOrProvince),
        postalCode: cleanString(shippingStep.shipTo.contactAddress.postalCode),
        county: cleanString(shippingStep.shipTo.contactAddress.county),
      }
    : null;
  const buyerPhone = cleanString(shippingStep?.shipTo?.primaryPhone?.phoneNumber);
  const buyerEmail = cleanString(shippingStep?.shipTo?.email);

  const totalPrice = toNumber(order.pricingSummary?.total?.value);
  const currency = cleanString(order.pricingSummary?.total?.currency);
  const createdAt = toDateOrNow(cleanString(order.creationDate) ?? cleanString(order.lastModifiedDate));
  const sourceStatus = cleanString(order.orderFulfillmentStatus);
  const lineItems = (order.lineItems ?? []).map(normalizeLineItem);

  return {
    marketplace: "ebay",
    marketplaceOrderId,
    buyerUsername,
    buyerName,
    buyerCountry,
    shippingAddress,
    buyerPhone,
    buyerEmail,
    totalPrice,
    currency,
    createdAt,
    sourceStatus,
    lineItems,
  };
}

export async function fetchEbayOrders(input?: {
  limit?: number;
  lookbackHours?: number;
}): Promise<FetchEbayOrdersResult> {
  const limit = Math.max(1, Math.min(100, Number(input?.limit ?? process.env.ORDER_SYNC_FETCH_LIMIT ?? "25")));
  const lookbackHours = Math.max(
    1,
    Math.min(24 * 14, Number(input?.lookbackHours ?? process.env.ORDER_SYNC_LOOKBACK_HOURS ?? "48"))
  );

  const validation = getEbayPublishEnvValidation();
  if (!validation.ok || !validation.config) {
    throw new Error(`eBay order sync env invalid: ${validation.errors.join("; ")}`);
  }

  const marketplace = normalizeOrderMarketplace(validation.config.marketplaceId) || "ebay_us";
  const startTs = new Date(Date.now() - lookbackHours * 60 * 60 * 1000).toISOString();
  const filter = `creationdate:[${startTs}..]`;
  const url = `https://api.ebay.com/sell/fulfillment/v1/order?limit=${limit}&filter=${encodeURIComponent(filter)}`;

  logOrderSyncDebug("fetch_context", {
    marketplace,
    limit,
    lookbackHours,
    startTs,
    filter,
    finalUrl: url,
  });

  let token: string;
  try {
    token = await getEbaySellAccessToken(validation.config);
  } catch (error) {
    logOrderSyncDebug("token_fetch_failed", {
      marketplace,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Language": "en-US",
      "X-EBAY-C-MARKETPLACE-ID": marketplace.toUpperCase(),
    },
  });

  const text = await resp.text();
  let body: EbayOrderListResponse = {};

  if (text) {
    try {
      body = JSON.parse(text) as EbayOrderListResponse;
    } catch {
      if (!resp.ok) {
        throw new Error(`eBay order fetch failed: ${resp.status} ${text.slice(0, 500)}`);
      }

      throw new Error("eBay order fetch returned non-JSON response body.");
    }
  }

  const rawOrders = Array.isArray(body.orders) ? body.orders : [];
  logOrderSyncDebug("fetch_response", {
    marketplace,
    status: resp.status,
    ok: resp.ok,
    bodyHasOrders: Array.isArray(body.orders),
    ordersLength: rawOrders.length,
    firstOrderId:
      cleanString(rawOrders[0]?.orderId) ??
      cleanString(rawOrders[0]?.legacyOrderId) ??
      null,
  });

  if (!resp.ok) {
    throw new Error(`eBay order fetch failed: ${resp.status} ${text.slice(0, 500)}`);
  }

  const normalized = rawOrders
    .map(normalizeOrder)
    .filter((order): order is NormalizedEbayOrder => Boolean(order));

  return {
    fetchedCount: rawOrders.length,
    normalizedCount: normalized.length,
    orders: normalized,
    lookbackHours,
    limit,
  };
}
