import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { supplierOrders } from "@/lib/db/schema";
import { recordSupplierTracking } from "@/lib/orders/manualPurchaseFlow";
import { syncTrackingToEbay } from "@/lib/orders/syncTrackingToEbay";
import { getOrderStatus, type CjOrderStatusResult } from "./cjApi";

type CandidateRow = {
  supplierOrderId: string;
  orderId: string;
  supplierKey: string;
  supplierOrderRef: string | null;
  purchaseStatus: string;
  trackingNumber: string | null;
  trackingCarrier: string | null;
  trackingSyncedAt: Date | null;
};

export type CjTrackingPollOrderResult = {
  orderId: string;
  supplierOrderId: string;
  outcome: "synced" | "tracking-recorded" | "skipped" | "failed";
  reason: string | null;
  trackingNumber: string | null;
  trackingCarrier: string | null;
};

export type CjTrackingPollResult = {
  ok: boolean;
  scanned: number;
  synced: number;
  recorded: number;
  skipped: number;
  failed: number;
  orders: CjTrackingPollOrderResult[];
};

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function findStringDeep(value: unknown, wantedKeys: Set<string>, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringDeep(entry, wantedKeys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const obj = asObject(value);
  if (!obj) return null;

  for (const [key, raw] of Object.entries(obj)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (wantedKeys.has(normalized)) {
      const found = clean(raw);
      if (found) return found;
    }
  }

  for (const raw of Object.values(obj)) {
    const found = findStringDeep(raw, wantedKeys, depth + 1);
    if (found) return found;
  }

  return null;
}

function extractTrackingNumber(status: CjOrderStatusResult): string | null {
  return (
    clean(status.trackNumber) ??
    findStringDeep(status.raw, new Set(["tracknumber", "trackingnumber", "trackno", "trackingno"]))
  );
}

function extractCarrier(status: CjOrderStatusResult): string | null {
  return (
    clean(status.logisticName) ??
    findStringDeep(
      status.raw,
      new Set([
        "logisticname",
        "logisticsname",
        "trackingcarrier",
        "carrier",
        "shippingcarrier",
        "shippingmethod",
      ])
    )
  );
}

function mapTrackingStatus(orderStatus: string | null): "LABEL_CREATED" | "IN_TRANSIT" | "DELIVERED" {
  const normalized = clean(orderStatus)?.toUpperCase() ?? "";
  if (normalized.includes("DELIVER")) return "DELIVERED";
  if (normalized.includes("SHIP")) return "IN_TRANSIT";
  return "LABEL_CREATED";
}

async function fetchCandidates(input?: { orderId?: string; limit?: number }): Promise<CandidateRow[]> {
  if (input?.orderId) {
    const rows = await db
      .select({
        supplierOrderId: supplierOrders.id,
        orderId: supplierOrders.orderId,
        supplierKey: supplierOrders.supplierKey,
        supplierOrderRef: supplierOrders.supplierOrderRef,
        purchaseStatus: supplierOrders.purchaseStatus,
        trackingNumber: supplierOrders.trackingNumber,
        trackingCarrier: supplierOrders.trackingCarrier,
        trackingSyncedAt: supplierOrders.trackingSyncedAt,
      })
      .from(supplierOrders)
      .where(
        and(
          eq(supplierOrders.orderId, input.orderId),
          eq(supplierOrders.supplierKey, "cjdropshipping")
        )
      )
      .orderBy(desc(supplierOrders.attemptNo), desc(supplierOrders.updatedAt), desc(supplierOrders.createdAt))
      .limit(1);

    return rows;
  }

  const limit = Math.max(1, Math.min(Number(input?.limit ?? 20), 100));
  return db
    .select({
      supplierOrderId: supplierOrders.id,
      orderId: supplierOrders.orderId,
      supplierKey: supplierOrders.supplierKey,
      supplierOrderRef: supplierOrders.supplierOrderRef,
      purchaseStatus: supplierOrders.purchaseStatus,
      trackingNumber: supplierOrders.trackingNumber,
      trackingCarrier: supplierOrders.trackingCarrier,
      trackingSyncedAt: supplierOrders.trackingSyncedAt,
    })
    .from(supplierOrders)
    .where(
      and(
        eq(supplierOrders.supplierKey, "cjdropshipping"),
        inArray(supplierOrders.purchaseStatus, ["SUBMITTED", "CONFIRMED"])
      )
    )
    .orderBy(desc(supplierOrders.updatedAt), desc(supplierOrders.createdAt))
    .limit(limit);
}

async function syncIfPossible(candidate: CandidateRow, actorId: string): Promise<CjTrackingPollOrderResult> {
  try {
    const sync = await syncTrackingToEbay({
      orderId: candidate.orderId,
      supplierOrderId: candidate.supplierOrderId,
      supplierKey: candidate.supplierKey,
      actorId,
    });

    return {
      orderId: candidate.orderId,
      supplierOrderId: candidate.supplierOrderId,
      outcome: sync.ok && sync.synced ? "synced" : "failed",
      reason: sync.reason,
      trackingNumber: candidate.trackingNumber,
      trackingCarrier: candidate.trackingCarrier,
    };
  } catch (error) {
    return {
      orderId: candidate.orderId,
      supplierOrderId: candidate.supplierOrderId,
      outcome: "failed",
      reason: error instanceof Error ? error.message : String(error),
      trackingNumber: candidate.trackingNumber,
      trackingCarrier: candidate.trackingCarrier,
    };
  }
}

async function processCandidate(candidate: CandidateRow, actorId: string): Promise<CjTrackingPollOrderResult> {
  if (!clean(candidate.supplierOrderRef)) {
    return {
      orderId: candidate.orderId,
      supplierOrderId: candidate.supplierOrderId,
      outcome: "skipped",
      reason: "supplier order ref missing",
      trackingNumber: clean(candidate.trackingNumber),
      trackingCarrier: clean(candidate.trackingCarrier),
    };
  }

  if (clean(candidate.trackingNumber) || clean(candidate.trackingCarrier)) {
    if (!clean(candidate.trackingNumber) || !clean(candidate.trackingCarrier)) {
      return {
        orderId: candidate.orderId,
        supplierOrderId: candidate.supplierOrderId,
        outcome: "skipped",
        reason: "existing tracking is partial; manual review required",
        trackingNumber: clean(candidate.trackingNumber),
        trackingCarrier: clean(candidate.trackingCarrier),
      };
    }

    if (candidate.trackingSyncedAt) {
      return {
        orderId: candidate.orderId,
        supplierOrderId: candidate.supplierOrderId,
        outcome: "skipped",
        reason: "tracking already synced",
        trackingNumber: clean(candidate.trackingNumber),
        trackingCarrier: clean(candidate.trackingCarrier),
      };
    }

    return syncIfPossible(candidate, actorId);
  }

  const status = await getOrderStatus(candidate.supplierOrderRef!);
  const trackingNumber = extractTrackingNumber(status);
  const trackingCarrier = extractCarrier(status);

  if (!trackingNumber || !trackingCarrier) {
    return {
      orderId: candidate.orderId,
      supplierOrderId: candidate.supplierOrderId,
      outcome: "skipped",
      reason: "CJ tracking not available yet",
      trackingNumber,
      trackingCarrier,
    };
  }

  await recordSupplierTracking({
    orderId: candidate.orderId,
    supplierKey: candidate.supplierKey,
    supplierOrderId: candidate.supplierOrderId,
    trackingNumber,
    trackingCarrier,
    trackingStatus: mapTrackingStatus(status.orderStatus),
    manualNote: "Tracking fetched automatically from CJ",
    actorId,
  });

  const sync = await syncIfPossible(
    {
      ...candidate,
      trackingNumber,
      trackingCarrier,
    },
    actorId
  );

  if (sync.outcome === "synced") {
    return sync;
  }

  return {
    orderId: candidate.orderId,
    supplierOrderId: candidate.supplierOrderId,
    outcome: "tracking-recorded",
    reason: sync.reason,
    trackingNumber,
    trackingCarrier,
  };
}

export async function pollCjTrackingAndSync(input?: {
  orderId?: string;
  limit?: number;
  actorId?: string;
}): Promise<CjTrackingPollResult> {
  const actorId = clean(input?.actorId) ?? "trackingSync.worker";
  const candidates = await fetchCandidates({
    orderId: clean(input?.orderId) ?? undefined,
    limit: input?.limit,
  });

  const orders: CjTrackingPollOrderResult[] = [];
  for (const candidate of candidates) {
    try {
      orders.push(await processCandidate(candidate, actorId));
    } catch (error) {
      orders.push({
        orderId: candidate.orderId,
        supplierOrderId: candidate.supplierOrderId,
        outcome: "failed",
        reason: error instanceof Error ? error.message : String(error),
        trackingNumber: clean(candidate.trackingNumber),
        trackingCarrier: clean(candidate.trackingCarrier),
      });
    }
  }

  return {
    ok: true,
    scanned: candidates.length,
    synced: orders.filter((row) => row.outcome === "synced").length,
    recorded: orders.filter((row) => row.outcome === "tracking-recorded").length,
    skipped: orders.filter((row) => row.outcome === "skipped").length,
    failed: orders.filter((row) => row.outcome === "failed").length,
    orders,
  };
}
