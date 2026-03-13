import { and, eq } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { db } from "@/lib/db";
import { supplierOrders } from "@/lib/db/schema";
import {
  getEbayPublishEnvValidation,
  getEbaySellAccessToken,
} from "@/lib/marketplaces/ebayPublish";
import { createOrderEvent } from "./orderEvents";
import { ORDER_STATUS } from "./statuses";
import { prepareTrackingSyncPayload } from "./trackingSync";
import { transitionOrderStatus } from "./updateOrderStatus";

type EbayLineItem = {
  lineItemId?: string;
  quantity?: number;
};

type EbayOrderDetail = {
  orderId?: string;
  lineItems?: EbayLineItem[];
};

const KNOWN_CARRIER_MAP: Record<string, string> = {
  UPS: "UPS",
  "UNITED PARCEL SERVICE": "UPS",
  USPS: "USPS",
  "US POSTAL SERVICE": "USPS",
  FEDEX: "FEDEX",
  "FEDERAL EXPRESS": "FEDEX",
  DHL: "DHL",
  ONTRAC: "ONTRAC",
  LASERSHIP: "LASERSHIP",
  ROYALMAIL: "ROYAL_MAIL",
  "ROYAL MAIL": "ROYAL_MAIL",
};

function normalizeCarrierCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const direct = trimmed.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();
  if (!direct) return null;

  if (KNOWN_CARRIER_MAP[direct]) return KNOWN_CARRIER_MAP[direct];

  // Allow explicit eBay-like codes if operator already provided one.
  if (/^[A-Z0-9_]{2,40}$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  return null;
}

async function ebayRequest<T>(url: string, init: RequestInit, context: string): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });

  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as unknown) : {};

  if (!response.ok) {
    throw new Error(`eBay ${context} failed: ${response.status} ${text.slice(0, 500)}`);
  }

  return parsed as T;
}

function extractSingleLineItem(order: EbayOrderDetail): { lineItemId: string; quantity: number } {
  const lineItems = Array.isArray(order.lineItems) ? order.lineItems : [];
  if (lineItems.length !== 1) {
    throw new Error(
      `B5 v1 supports single-package/single-line only. eBay order has ${lineItems.length} line items.`
    );
  }

  const [item] = lineItems;
  const lineItemId = String(item.lineItemId ?? "").trim();
  if (!lineItemId) {
    throw new Error("eBay order line item is missing lineItemId.");
  }

  const quantity = Number(item.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity < 1) {
    throw new Error(`Invalid eBay line item quantity: ${item.quantity}`);
  }

  return {
    lineItemId,
    quantity: Math.trunc(quantity),
  };
}

async function recordTrackingSyncAttempt(input: {
  supplierOrderId: string;
  success: boolean;
  errorMessage?: string | null;
  response?: unknown;
}) {
  if (input.success) {
    await db
      .update(supplierOrders)
      .set({
        trackingSyncLastAttemptAt: new Date(),
        trackingSyncedAt: new Date(),
        trackingSyncError: null,
        trackingSyncLastResponse: input.response ?? null,
        updatedAt: new Date(),
      })
      .where(eq(supplierOrders.id, input.supplierOrderId));
    return;
  }

  await db
    .update(supplierOrders)
    .set({
      trackingSyncLastAttemptAt: new Date(),
      trackingSyncError: input.errorMessage ?? "Unknown tracking sync error",
      trackingSyncLastResponse: input.response ?? null,
      updatedAt: new Date(),
    })
    .where(eq(supplierOrders.id, input.supplierOrderId));
}

export type SyncTrackingToEbayResult = {
  ok: boolean;
  orderId: string;
  supplierOrderId: string | null;
  marketplaceOrderId: string | null;
  attemptedLiveCall: boolean;
  synced: boolean;
  reason: string | null;
};

export async function syncTrackingToEbay(input: {
  orderId: string;
  supplierOrderId?: string;
  supplierKey?: string;
  actorId?: string;
}): Promise<SyncTrackingToEbayResult> {
  const actorId = input.actorId ?? "orders.tracking-sync";
  let preparedSupplierOrderId: string | null = null;
  let marketplaceOrderId: string | null = null;
  let attemptedLiveCall = false;

  try {
    if (process.env.ENABLE_EBAY_TRACKING_SYNC !== "true") {
      throw new Error(
        "Live tracking sync is disabled. Set ENABLE_EBAY_TRACKING_SYNC=true for controlled execution."
      );
    }

    const payload = await prepareTrackingSyncPayload({
      orderId: input.orderId,
      supplierOrderId: input.supplierOrderId,
      supplierKey: input.supplierKey,
    });

    preparedSupplierOrderId = payload.supplierOrderId;
    marketplaceOrderId = payload.marketplaceOrderId;

    const carrierCode = normalizeCarrierCode(payload.tracking.trackingCarrier);
    if (!carrierCode) {
      throw new Error(
        `tracking_carrier '${payload.tracking.trackingCarrier}' is not a supported eBay carrier code for v1.`
      );
    }

    const env = getEbayPublishEnvValidation();
    if (!env.ok || !env.config) {
      throw new Error(`eBay env invalid for tracking sync: ${env.errors.join(" | ")}`);
    }

    const token = await getEbaySellAccessToken(env.config);

    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": env.config.marketplaceId,
      "Content-Language": "en-US",
      "Accept-Language": "en-US",
    };

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "TRACKING_SYNC_ATTEMPTED",
      details: {
        supplierOrderId: payload.supplierOrderId,
        marketplaceOrderId: payload.marketplaceOrderId,
        carrierCode,
        actorId,
      },
    });

    const orderDetail = await ebayRequest<EbayOrderDetail>(
      `https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(payload.marketplaceOrderId)}`,
      {
        method: "GET",
        headers: baseHeaders,
      },
      "order detail lookup"
    );

    const singleLine = extractSingleLineItem(orderDetail);

    const shippedDate = new Date().toISOString();
    const fulfillmentRequest = {
      lineItems: [
        {
          lineItemId: singleLine.lineItemId,
          quantity: singleLine.quantity,
        },
      ],
      shippedDate,
      shippingCarrierCode: carrierCode,
      trackingNumber: payload.tracking.trackingNumber,
    };

    attemptedLiveCall = true;
    const fulfillmentResponse = await ebayRequest<Record<string, unknown>>(
      `https://api.ebay.com/sell/fulfillment/v1/order/${encodeURIComponent(payload.marketplaceOrderId)}/shipping_fulfillment`,
      {
        method: "POST",
        headers: baseHeaders,
        body: JSON.stringify(fulfillmentRequest),
      },
      "tracking submission"
    );

    await recordTrackingSyncAttempt({
      supplierOrderId: payload.supplierOrderId,
      success: true,
      response: {
        request: fulfillmentRequest,
        response: fulfillmentResponse,
      },
    });

    await transitionOrderStatus({
      orderId: input.orderId,
      nextStatus: ORDER_STATUS.TRACKING_SYNCED,
      actorId,
      reason: "Tracking synced to eBay",
      details: {
        supplierOrderId: payload.supplierOrderId,
        marketplaceOrderId: payload.marketplaceOrderId,
      },
    });

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "TRACKING_SYNC_SUCCEEDED",
      details: {
        supplierOrderId: payload.supplierOrderId,
        marketplaceOrderId: payload.marketplaceOrderId,
        actorId,
      },
    });

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "ORDER",
      entityId: input.orderId,
      eventType: "ORDER_TRACKING_SYNC_SUCCEEDED",
      details: {
        marketplace: "ebay",
        marketplaceOrderId: payload.marketplaceOrderId,
        supplierOrderId: payload.supplierOrderId,
      },
    });

    return {
      ok: true,
      orderId: input.orderId,
      supplierOrderId: payload.supplierOrderId,
      marketplaceOrderId: payload.marketplaceOrderId,
      attemptedLiveCall,
      synced: true,
      reason: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (preparedSupplierOrderId) {
      await recordTrackingSyncAttempt({
        supplierOrderId: preparedSupplierOrderId,
        success: false,
        errorMessage: message,
      });
    }

    try {
      await createOrderEvent({
        orderId: input.orderId,
        eventType: "TRACKING_SYNC_FAILED",
        details: {
          supplierOrderId: preparedSupplierOrderId,
          marketplaceOrderId,
          actorId,
          error: message,
        },
      });

      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "ORDER",
        entityId: input.orderId,
        eventType: "ORDER_TRACKING_SYNC_FAILED",
        details: {
          marketplace: "ebay",
          marketplaceOrderId,
          supplierOrderId: preparedSupplierOrderId,
          error: message,
        },
      });
    } catch {
      // Best-effort failure logging only; preserve original sync failure result.
    }

    return {
      ok: false,
      orderId: input.orderId,
      supplierOrderId: preparedSupplierOrderId,
      marketplaceOrderId,
      attemptedLiveCall,
      synced: false,
      reason: message,
    };
  }
}

export async function getTrackingSyncAttemptState(input: {
  orderId: string;
  supplierOrderId: string;
}) {
  const rows = await db
    .select({
      id: supplierOrders.id,
      orderId: supplierOrders.orderId,
      supplierKey: supplierOrders.supplierKey,
      trackingSyncLastAttemptAt: supplierOrders.trackingSyncLastAttemptAt,
      trackingSyncedAt: supplierOrders.trackingSyncedAt,
      trackingSyncError: supplierOrders.trackingSyncError,
      trackingSyncLastResponse: supplierOrders.trackingSyncLastResponse,
    })
    .from(supplierOrders)
    .where(
      and(
        eq(supplierOrders.orderId, input.orderId),
        eq(supplierOrders.id, input.supplierOrderId)
      )
    )
    .limit(1);

  return rows[0] ?? null;
}
