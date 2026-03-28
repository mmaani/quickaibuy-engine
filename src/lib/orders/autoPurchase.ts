import { Queue } from "bullmq";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { bullConnection } from "@/lib/bull";
import { db } from "@/lib/db";
import { supplierOrders } from "@/lib/db/schema";
import { BULL_PREFIX, JOB_NAMES, JOBS_QUEUE_NAME } from "@/lib/jobs/jobNames";
import { markJobQueued } from "@/lib/jobs/jobLedger";
import { createOrder, getOrderStatus as getCjOrderStatus } from "@/lib/suppliers/cjApi";
import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";
import { getScaleRolloutCaps } from "@/lib/control/scaleRolloutConfig";
import { createOrderEvent } from "./orderEvents";
import { getAutoPurchaseRateLimitState } from "./autoPurchaseRateLimiter";
import { getOrderPurchaseSafetyStatusByOrderId } from "./purchaseSafety";
import { recordSupplierPurchase } from "./manualPurchaseFlow";

const jobsQueue = new Queue(JOBS_QUEUE_NAME, {
  connection: bullConnection,
  prefix: BULL_PREFIX,
});

type AutoPurchaseCandidate = {
  orderId: string;
};

type AutoPurchaseOrderRow = {
  orderId: string;
  marketplaceOrderId: string;
  status: string;
  buyerName: string | null;
  buyerCountry: string | null;
  rawPayload: unknown;
};

type AutoPurchaseItemRow = {
  orderItemId: string;
  listingId: string | null;
  supplierKey: string | null;
  supplierProductId: string | null;
  quantity: number;
  latestSupplierRawPayload: unknown;
  latestShippingEstimates: unknown;
};

type ShippingRecipient = {
  name: string;
  countryCode: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateOrProvince: string;
  postalCode: string;
  county: string | null;
  phone: string;
  email: string | null;
};

type ShippingEstimate = {
  label?: string;
  ship_from_country?: string | null;
  ship_from_location?: string | null;
};

type AutoPurchaseResult = {
  ok: boolean;
  scanned: number;
  attempted: number;
  submitted: number;
  skipped: number;
  failed: number;
  orders: Array<{
    orderId: string;
    outcome: "submitted" | "skipped" | "failed";
    reason: string | null;
    supplierOrderRef: string | null;
  }>;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeSupplierKey(value: string | null): string | null {
  const normalized = cleanString(value)?.toLowerCase() ?? null;
  if (normalized === "cj dropshipping") return "cjdropshipping";
  return normalized;
}

function extractRecipient(order: AutoPurchaseOrderRow): ShippingRecipient | null {
  const raw = asObject(order.rawPayload);
  const shippingAddress = asObject(raw?.shippingAddress);
  const name = cleanString(raw?.buyerName) ?? cleanString(order.buyerName);
  const countryCode =
    cleanString(shippingAddress?.countryCode) ?? cleanString(raw?.buyerCountry) ?? cleanString(order.buyerCountry);
  const addressLine1 = cleanString(shippingAddress?.addressLine1);
  const city = cleanString(shippingAddress?.city);
  const stateOrProvince = cleanString(shippingAddress?.stateOrProvince);
  const postalCode = cleanString(shippingAddress?.postalCode);
  const phone = cleanString(raw?.buyerPhone);

  if (!name || !countryCode || !addressLine1 || !city || !stateOrProvince || !postalCode || !phone) {
    return null;
  }

  return {
    name,
    countryCode,
    addressLine1,
    addressLine2: cleanString(shippingAddress?.addressLine2),
    city,
    stateOrProvince,
    postalCode,
    county: cleanString(shippingAddress?.county),
    phone,
    email: cleanString(raw?.buyerEmail),
  };
}

function pickDistinctStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const cleaned = cleanString(value);
    if (cleaned) {
      seen.add(cleaned);
    }
  }
  return Array.from(seen);
}

function resolveCjSku(rawPayload: unknown): { sku: string | null; fromCountryCode: string | null; logisticName: string | null } {
  const raw = asObject(rawPayload);
  const rawSku = cleanString(raw?.sku);
  const variantMapping = asArray(raw?.variantMapping)
    .map((entry) => asObject(entry))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry));
  const variantSkus = pickDistinctStrings(variantMapping.map((entry) => entry.sku));
  const distinctSkus = pickDistinctStrings([rawSku, ...variantSkus]);

  const estimates = asArray(raw?.shippingEstimates).concat(asArray(raw?.shipping_estimates));
  const normalizedEstimates = estimates
    .map((entry) => asObject(entry) as ShippingEstimate | null)
    .filter((entry): entry is ShippingEstimate => Boolean(entry));
  const firstEstimate = normalizedEstimates[0] ?? null;

  if (distinctSkus.length !== 1) {
    return {
      sku: null,
      fromCountryCode: cleanString(firstEstimate?.ship_from_country) ?? cleanString(raw?.shipFromCountry),
      logisticName: cleanString(firstEstimate?.label),
    };
  }

  return {
    sku: distinctSkus[0],
    fromCountryCode: cleanString(firstEstimate?.ship_from_country) ?? cleanString(raw?.shipFromCountry),
    logisticName: cleanString(firstEstimate?.label),
  };
}

function mapCjOrderStatusToPurchaseStatus(value: string | null): "SUBMITTED" | "CONFIRMED" {
  const normalized = cleanString(value)?.toUpperCase() ?? "";
  if (normalized === "UNSHIPPED" || normalized === "SHIPPED" || normalized === "DELIVERED") {
    return "CONFIRMED";
  }
  return "SUBMITTED";
}

async function getLatestAttempt(orderId: string, supplierKey: string) {
  const rows = await db
    .select()
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, orderId), eq(supplierOrders.supplierKey, supplierKey)))
    .orderBy(desc(supplierOrders.attemptNo), desc(supplierOrders.updatedAt), desc(supplierOrders.createdAt))
    .limit(1);

  return rows[0] ?? null;
}

async function createFailedAttempt(input: {
  orderId: string;
  supplierKey: string;
  message: string;
  actorId?: string;
}) {
  const rows = await db
    .select({ maxAttemptNo: max(supplierOrders.attemptNo) })
    .from(supplierOrders)
    .where(and(eq(supplierOrders.orderId, input.orderId), eq(supplierOrders.supplierKey, input.supplierKey)));

  const nextAttemptNo = Number(rows[0]?.maxAttemptNo ?? 0) + 1;
  await db.insert(supplierOrders).values({
    orderId: input.orderId,
    supplierKey: input.supplierKey,
    attemptNo: nextAttemptNo,
    purchaseStatus: "FAILED",
    manualNote: input.message,
    updatedAt: new Date(),
  });

  await createOrderEvent({
    orderId: input.orderId,
    eventType: "PURCHASE_FAILED",
    details: {
      supplierKey: input.supplierKey,
      attemptNo: nextAttemptNo,
      actorId: input.actorId ?? null,
      error: input.message,
      autoPurchase: true,
    },
  });
}

async function fetchOrder(orderId: string): Promise<AutoPurchaseOrderRow | null> {
  const rows = await db.execute<AutoPurchaseOrderRow>(sql`
    SELECT
      o.id AS "orderId",
      o.marketplace_order_id AS "marketplaceOrderId",
      o.status AS status,
      o.buyer_name AS "buyerName",
      o.buyer_country AS "buyerCountry",
      o.raw_payload AS "rawPayload"
    FROM orders o
    WHERE o.id = ${orderId}
    LIMIT 1
  `);

  return rows.rows?.[0] ?? null;
}

async function fetchOrderItems(orderId: string): Promise<AutoPurchaseItemRow[]> {
  const rows = await db.execute<AutoPurchaseItemRow>(sql`
    SELECT
      oi.id::text AS "orderItemId",
      oi.listing_id::text AS "listingId",
      oi.supplier_key AS "supplierKey",
      oi.supplier_product_id AS "supplierProductId",
      oi.quantity AS quantity,
      latest_pr.raw_payload AS "latestSupplierRawPayload",
      latest_pr.shipping_estimates AS "latestShippingEstimates"
    FROM order_items oi
    LEFT JOIN LATERAL (
      SELECT pr.raw_payload, pr.shipping_estimates
      FROM products_raw pr
      WHERE pr.supplier_key = oi.supplier_key
        AND pr.supplier_product_id = oi.supplier_product_id
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    ) latest_pr ON TRUE
    WHERE oi.order_id = ${orderId}
    ORDER BY oi.created_at ASC
  `);

  return rows.rows ?? [];
}

async function fetchCandidateOrders(input?: {
  orderId?: string;
  limit?: number;
}): Promise<AutoPurchaseCandidate[]> {
  if (input?.orderId) {
    return [{ orderId: input.orderId }];
  }

  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20), 100));
  const rows = await db.execute<AutoPurchaseCandidate>(sql`
    SELECT o.id AS "orderId"
    FROM orders o
    WHERE o.marketplace = 'ebay'
      AND o.status = 'PURCHASE_APPROVED'
    ORDER BY o.updated_at DESC NULLS LAST
    LIMIT ${limit}
  `);
  return rows.rows ?? [];
}

export async function enqueueAutoPurchase(input: {
  orderId: string;
  actorId?: string;
}) {
  const payload = {
    orderId: input.orderId,
    actorId: input.actorId ?? "autoPurchase.enqueue",
  };
  const jobId = `auto-purchase-${input.orderId}`;
  const job = await jobsQueue.add(JOB_NAMES.AUTO_PURCHASE, payload, {
    jobId,
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  });

  await markJobQueued({
    jobType: JOB_NAMES.AUTO_PURCHASE,
    idempotencyKey: String(job.id),
    payload,
    attempt: 0,
    maxAttempts: 3,
  });

  return job;
}

async function processOneOrder(input: {
  orderId: string;
  actorId?: string;
}): Promise<{ outcome: "submitted" | "skipped" | "failed"; reason: string | null; supplierOrderRef: string | null }> {
  const safety = await getOrderPurchaseSafetyStatusByOrderId({
    orderId: input.orderId,
    actorId: input.actorId,
    writeEvent: false,
    gate: "READ_ONLY",
  });

  if (safety.status !== "READY_FOR_PURCHASE_REVIEW") {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: `purchase safety blocked: ${safety.status}`,
      },
    });
    return {
      outcome: "skipped",
      reason: `purchase safety blocked: ${safety.status}`,
      supplierOrderRef: null,
    };
  }

  const order = await fetchOrder(input.orderId);
  if (!order) {
    return {
      outcome: "failed",
      reason: "order not found",
      supplierOrderRef: null,
    };
  }

  if (order.status !== "PURCHASE_APPROVED") {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: `order status is ${order.status}, expected PURCHASE_APPROVED`,
      },
    });
    return {
      outcome: "skipped",
      reason: `order status is ${order.status}, expected PURCHASE_APPROVED`,
      supplierOrderRef: null,
    };
  }

  const recipient = extractRecipient(order);
  if (!recipient) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "shipping contact is incomplete",
      },
    });
    return {
      outcome: "skipped",
      reason: "shipping contact is incomplete",
      supplierOrderRef: null,
    };
  }

  const items = await fetchOrderItems(input.orderId);
  if (!items.length) {
    return {
      outcome: "failed",
      reason: "order has no items",
      supplierOrderRef: null,
    };
  }

  const normalizedSupplierKeys = pickDistinctStrings(items.map((item) => normalizeSupplierKey(item.supplierKey)));
  if (normalizedSupplierKeys.length !== 1 || normalizedSupplierKeys[0] !== "cjdropshipping") {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "order is not a single-supplier CJ order",
      },
    });
    return {
      outcome: "skipped",
      reason: "order is not a single-supplier CJ order",
      supplierOrderRef: null,
    };
  }

  if (items.some((item) => !cleanString(item.supplierProductId))) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "supplier linkage missing",
      },
    });
    return {
      outcome: "skipped",
      reason: "supplier linkage missing",
      supplierOrderRef: null,
    };
  }

  const existingAttempt = await getLatestAttempt(input.orderId, "cjdropshipping");
  if (existingAttempt && ["SUBMITTED", "CONFIRMED"].includes(existingAttempt.purchaseStatus)) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "CJ purchase attempt already exists",
      },
    });
    return {
      outcome: "skipped",
      reason: "CJ purchase attempt already exists",
      supplierOrderRef: cleanString(existingAttempt.supplierOrderRef),
    };
  }
  if (existingAttempt && existingAttempt.purchaseStatus === "FAILED") {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "latest CJ purchase attempt already failed; manual retry required",
      },
    });
    return {
      outcome: "skipped",
      reason: "latest CJ purchase attempt already failed; manual retry required",
      supplierOrderRef: cleanString(existingAttempt.supplierOrderRef),
    };
  }

  const resolvedProducts = items.map((item) => {
    const latestRaw = asObject(item.latestSupplierRawPayload) ?? {};
    const latestRawWithShipping = {
      ...latestRaw,
      shippingEstimates: asArray(item.latestShippingEstimates),
    };
    const resolved = resolveCjSku(latestRawWithShipping);
    return {
      orderItemId: item.orderItemId,
      quantity: item.quantity,
      supplierProductId: item.supplierProductId,
      sku: resolved.sku,
      fromCountryCode: resolved.fromCountryCode,
      logisticName: resolved.logisticName,
    };
  });

  if (resolvedProducts.some((item) => !item.sku)) {
    await createOrderEvent({
      orderId: input.orderId,
      eventType: "MANUAL_NOTE",
      details: {
        action: "AUTO_PURCHASE_SKIPPED",
        actorId: input.actorId ?? null,
        reason: "CJ SKU resolution is ambiguous or missing",
      },
    });
    return {
      outcome: "skipped",
      reason: "CJ SKU resolution is ambiguous or missing",
      supplierOrderRef: null,
    };
  }

  const logisticName =
    cleanString(resolvedProducts[0]?.logisticName) ??
    null;
  const fromCountryCode =
    cleanString(resolvedProducts[0]?.fromCountryCode) ??
    null;

  try {
    const created = await createOrder({
      orderNumber: order.marketplaceOrderId,
      shippingZip: recipient.postalCode,
      shippingCountry: recipient.countryCode,
      shippingCountryCode: recipient.countryCode,
      shippingProvince: recipient.stateOrProvince,
      shippingCity: recipient.city,
      shippingCounty: recipient.county,
      shippingPhone: recipient.phone,
      shippingCustomerName: recipient.name,
      shippingAddress: recipient.addressLine1,
      shippingAddress2: recipient.addressLine2,
      email: recipient.email,
      remark: `Auto-created from eBay order ${order.marketplaceOrderId}`,
      logisticName,
      fromCountryCode,
      platform: "ebay",
      products: resolvedProducts.map((product) => ({
        sku: product.sku,
        quantity: product.quantity,
        storeLineItemId: product.orderItemId,
      })),
    });

    const statusResult =
      created.orderId != null ? await getCjOrderStatus(created.orderId).catch(() => null) : null;
    const supplierOrderRef =
      cleanString(statusResult?.orderId) ??
      cleanString(created.orderId) ??
      cleanString(created.cjOrderId) ??
      cleanString(created.orderNum);

    await recordSupplierPurchase({
      orderId: input.orderId,
      supplierKey: "cjdropshipping",
      supplierOrderRef,
      purchaseStatus: mapCjOrderStatusToPurchaseStatus(statusResult?.orderStatus ?? created.orderStatus),
      manualNote: "Auto-created CJ order",
      actorId: input.actorId ?? "autoPurchase.worker",
    });

    await createOrderEvent({
      orderId: input.orderId,
      eventType: "PURCHASE_SUBMITTED",
      details: {
        supplierKey: "cjdropshipping",
        supplierOrderRef,
        cjOrderStatus: statusResult?.orderStatus ?? created.orderStatus,
        autoPurchase: true,
      },
    });

    return {
      outcome: "submitted",
      reason: null,
      supplierOrderRef,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await createFailedAttempt({
      orderId: input.orderId,
      supplierKey: "cjdropshipping",
      message,
      actorId: input.actorId,
    });
    return {
      outcome: "failed",
      reason: message,
      supplierOrderRef: null,
    };
  }
}

export async function runAutoPurchase(input?: {
  orderId?: string;
  limit?: number;
  actorId?: string;
}): Promise<AutoPurchaseResult> {
  const manualOverrides = await getManualOverrideSnapshot();
  if (manualOverrides.entries.PAUSE_AUTO_PURCHASE.enabled) {
    return {
      ok: false,
      scanned: 0,
      attempted: 0,
      submitted: 0,
      skipped: 0,
      failed: 0,
      orders: [],
    };
  }

  const rateLimit = await getAutoPurchaseRateLimitState();
  if (!rateLimit.allowed) {
    return {
      ok: false,
      scanned: 0,
      attempted: 0,
      submitted: 0,
      skipped: 0,
      failed: 0,
      orders: [],
    };
  }

  const rolloutCaps = getScaleRolloutCaps();
  const candidates = await fetchCandidateOrders({
    orderId: input?.orderId,
    limit: Math.min(input?.limit ?? rolloutCaps.autoPurchaseLimitPerRun, rolloutCaps.autoPurchaseLimitPerRun),
  });

  const result: AutoPurchaseResult = {
    ok: true,
    scanned: candidates.length,
    attempted: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    orders: [],
  };

  for (const candidate of candidates) {
    const refreshedOverrides = await getManualOverrideSnapshot();
    if (refreshedOverrides.entries.PAUSE_SUPPLIER_CJ.enabled) {
      result.skipped += 1;
      result.orders.push({
        orderId: candidate.orderId,
        outcome: "skipped",
        reason: "supplier flow paused: cjdropshipping",
        supplierOrderRef: null,
      });
      continue;
    }
    result.attempted += 1;
    const processed = await processOneOrder({
      orderId: candidate.orderId,
      actorId: input?.actorId ?? "autoPurchase.worker",
    });
    if (processed.outcome === "submitted") result.submitted += 1;
    if (processed.outcome === "skipped") result.skipped += 1;
    if (processed.outcome === "failed") result.failed += 1;
    result.orders.push({
      orderId: candidate.orderId,
      outcome: processed.outcome,
      reason: processed.reason,
      supplierOrderRef: processed.supplierOrderRef,
    });
  }

  return result;
}
