import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { normalizeAvailabilitySignal } from "@/lib/products/supplierAvailability";
import { sql } from "drizzle-orm";
import {
  type InventoryRiskSignal,
  resolveInventoryRiskAction,
} from "./riskSignals";

type MonitorRow = {
  listingId: string;
  candidateId: string;
  listingStatus: string;
  marketplaceKey: string;
  supplierKey: string;
  supplierProductId: string;
  listingPayload: unknown;

  originalSupplierPrice: string | null;
  originalSupplierSnapshotTs: Date | string | null;
  originalSupplierShippingEstimates: unknown;
  originalSupplierRawPayload: unknown;

  latestSupplierPrice: string | null;
  latestSupplierSnapshotTs: Date | string | null;
  latestSupplierAvailabilityStatus: string | null;
  latestSupplierShippingEstimates: unknown;
  latestSupplierRawPayload: unknown;

  latestMarketplaceSnapshotTs: Date | string | null;
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function computePctChange(original: number | null, latest: number | null): number | null {
  if (original == null || latest == null || original <= 0) return null;
  return round2(((latest - original) / original) * 100);
}

function computeAgeHours(now: Date, snapshotTs: Date | null): number | null {
  if (!snapshotTs) return null;
  return round2((now.getTime() - snapshotTs.getTime()) / (1000 * 60 * 60));
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readNestedString(obj: Record<string, unknown> | null, keys: string[]): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function parseShippingFingerprint(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const normalized = value.trim().toUpperCase();
    return normalized || null;
  }

  if (Array.isArray(value)) {
    const fingerprints = value
      .map((item) => parseShippingFingerprint(item))
      .filter((item): item is string => Boolean(item));
    if (fingerprints.length === 0) return null;
    return Array.from(new Set(fingerprints)).sort().join("|");
  }

  const obj = asObject(value);
  if (!obj) return null;

  const country = readNestedString(obj, [
    "shipFromCountry",
    "ship_from_country",
    "warehouseCountry",
    "warehouse_country",
    "originCountry",
    "origin_country",
    "country",
  ]);
  const service = readNestedString(obj, ["service", "shippingService", "shipping_service"]);
  const eta = readNestedString(obj, ["eta", "deliveryEta", "delivery_eta", "estimatedDays"]);

  const parts = [country, service, eta]
    .filter((part): part is string => Boolean(part))
    .map((part) => part.toUpperCase());

  if (parts.length === 0) return null;
  return parts.join("-");
}

function getListingAssumedShipFromCountry(payload: unknown): string | null {
  const root = asObject(payload);
  const source = asObject(root?.source);
  const value =
    readNestedString(source, ["shipFromCountry", "supplierWarehouseCountry"]) ??
    readNestedString(root, ["shipFromCountry"]);
  return value ? value.toUpperCase() : null;
}

function detectFetchFailure(payload: unknown): boolean {
  const raw = asObject(payload);
  if (!raw) return false;

  const boolFailureSignals = [
    raw.fetchFailed,
    raw.fetch_failed,
    raw.isRemoved,
    raw.listingRemoved,
    raw.notFound,
  ];

  if (boolFailureSignals.some((v) => v === true)) return true;

  const fetchOk = raw.fetchOk ?? raw.fetch_ok;
  if (fetchOk === false) return true;

  const httpStatus = toNumber(raw.httpStatus ?? raw.http_status ?? raw.statusCode ?? raw.status_code);
  if (httpStatus != null && httpStatus >= 400) return true;

  const errorText = String(raw.error ?? raw.fetchError ?? raw.message ?? "").toLowerCase();
  return (
    errorText.includes("not found") ||
    errorText.includes("removed") ||
    errorText.includes("unavailable") ||
    errorText.includes("fetch failed")
  );
}

async function getRecentSupplierFetchFailures(input: {
  supplierKey: string;
  supplierProductId: string;
  windowSize: number;
}): Promise<number> {
  const rows = await db.execute<{ rawPayload: unknown }>(sql`
    SELECT pr.raw_payload AS "rawPayload"
    FROM products_raw pr
    WHERE pr.supplier_key = ${input.supplierKey}
      AND pr.supplier_product_id = ${input.supplierProductId}
    ORDER BY pr.snapshot_ts DESC, pr.id DESC
    LIMIT ${input.windowSize}
  `);

  return (rows.rows ?? []).reduce((count, row) => {
    return count + (detectFetchFailure(row.rawPayload) ? 1 : 0);
  }, 0);
}

function evaluateSignals(row: MonitorRow, now: Date): {
  signals: InventoryRiskSignal[];
  metrics: Record<string, unknown>;
} {
  const signals: InventoryRiskSignal[] = [];

  const originalSupplierPrice = toNumber(row.originalSupplierPrice);
  const latestSupplierPrice = toNumber(row.latestSupplierPrice);
  const supplierPriceDriftPct = computePctChange(originalSupplierPrice, latestSupplierPrice);

  const latestSupplierSnapshotTs = toDate(row.latestSupplierSnapshotTs);
  const supplierSnapshotAgeHours = computeAgeHours(now, latestSupplierSnapshotTs);
  const availabilitySignal = normalizeAvailabilitySignal(row.latestSupplierAvailabilityStatus);

  const assumedShipFromCountry = getListingAssumedShipFromCountry(row.listingPayload);
  const latestShippingFingerprint =
    parseShippingFingerprint(row.latestSupplierShippingEstimates) ??
    parseShippingFingerprint(row.latestSupplierRawPayload);
  const originalShippingFingerprint =
    parseShippingFingerprint(row.originalSupplierShippingEstimates) ??
    parseShippingFingerprint(row.originalSupplierRawPayload);

  if (supplierPriceDriftPct != null && Math.abs(supplierPriceDriftPct) > 15) {
    signals.push({
      code: "PRICE_DRIFT_HIGH",
      severity: "MEDIUM",
      message: "Supplier price drift exceeds 15%.",
      meta: {
        supplier_price_drift_pct: supplierPriceDriftPct,
        threshold_pct: 15,
      },
    });
  }

  if (availabilitySignal === "OUT_OF_STOCK") {
    signals.push({
      code: "SUPPLIER_OUT_OF_STOCK",
      severity: "HIGH",
      message: "Latest supplier availability indicates out of stock.",
      meta: { availability_signal: availabilitySignal },
    });
  }

  if (supplierSnapshotAgeHours != null && supplierSnapshotAgeHours > 72) {
    signals.push({
      code: "SNAPSHOT_TOO_OLD",
      severity: "LOW",
      message: "Supplier snapshot age exceeds 72 hours.",
      meta: {
        supplier_snapshot_age_hours: supplierSnapshotAgeHours,
        threshold_hours: 72,
      },
    });
  }

  const shippingChanged =
    (assumedShipFromCountry &&
      latestShippingFingerprint &&
      !latestShippingFingerprint.includes(assumedShipFromCountry)) ||
    (originalShippingFingerprint &&
      latestShippingFingerprint &&
      originalShippingFingerprint !== latestShippingFingerprint);

  if (shippingChanged) {
    signals.push({
      code: "SUPPLIER_SHIPPING_CHANGED",
      severity: "MEDIUM",
      message: "Supplier shipping characteristics changed from listing-safe assumptions.",
      meta: {
        assumed_ship_from_country: assumedShipFromCountry,
        original_shipping_fingerprint: originalShippingFingerprint,
        latest_shipping_fingerprint: latestShippingFingerprint,
      },
    });
  }

  return {
    signals,
    metrics: {
      supplier_price_drift_pct: supplierPriceDriftPct,
      supplier_snapshot_age_hours: supplierSnapshotAgeHours,
      availability_signal: availabilitySignal,
      assumed_ship_from_country: assumedShipFromCountry,
      original_shipping_fingerprint: originalShippingFingerprint,
      latest_shipping_fingerprint: latestShippingFingerprint,
      latest_marketplace_snapshot_ts: row.latestMarketplaceSnapshotTs
        ? String(row.latestMarketplaceSnapshotTs)
        : null,
    },
  };
}

export async function runInventoryRiskMonitor(input?: {
  limit?: number;
  marketplaceKey?: "ebay";
  actorId?: string;
  fetchFailureThreshold?: number;
  fetchFailureWindowSize?: number;
}) {
  const limit = Number(input?.limit ?? 100);
  const marketplaceKey = (input?.marketplaceKey ?? "ebay") as "ebay";
  const actorId = input?.actorId ?? "inventoryRisk.worker";
  const fetchFailureThreshold = Number(input?.fetchFailureThreshold ?? 3);
  const fetchFailureWindowSize = Number(input?.fetchFailureWindowSize ?? 3);
  const now = new Date();

  const rowsResult = await db.execute<MonitorRow>(sql`
    SELECT
      l.id AS "listingId",
      l.candidate_id AS "candidateId",
      l.status AS "listingStatus",
      l.marketplace_key AS "marketplaceKey",
      pc.supplier_key AS "supplierKey",
      pc.supplier_product_id AS "supplierProductId",
      l.payload AS "listingPayload",

      base_pr.price_min::text AS "originalSupplierPrice",
      base_pr.snapshot_ts AS "originalSupplierSnapshotTs",
      base_pr.shipping_estimates AS "originalSupplierShippingEstimates",
      base_pr.raw_payload AS "originalSupplierRawPayload",

      latest_pr.price_min::text AS "latestSupplierPrice",
      latest_pr.snapshot_ts AS "latestSupplierSnapshotTs",
      latest_pr.availability_status AS "latestSupplierAvailabilityStatus",
      latest_pr.shipping_estimates AS "latestSupplierShippingEstimates",
      latest_pr.raw_payload AS "latestSupplierRawPayload",

      latest_mp.snapshot_ts AS "latestMarketplaceSnapshotTs"
    FROM listings l
    INNER JOIN profitable_candidates pc
      ON pc.id = l.candidate_id
    LEFT JOIN products_raw base_pr
      ON base_pr.id = pc.supplier_snapshot_id
    LEFT JOIN LATERAL (
      SELECT
        pr.price_min,
        pr.snapshot_ts,
        pr.availability_status,
        pr.shipping_estimates,
        pr.raw_payload
      FROM products_raw pr
      WHERE pr.supplier_key = pc.supplier_key
        AND pr.supplier_product_id = pc.supplier_product_id
      ORDER BY pr.snapshot_ts DESC, pr.id DESC
      LIMIT 1
    ) latest_pr ON TRUE
    LEFT JOIN LATERAL (
      SELECT mp.snapshot_ts
      FROM marketplace_prices mp
      WHERE LOWER(mp.marketplace_key) = LOWER(l.marketplace_key)
        AND mp.marketplace_listing_id = pc.marketplace_listing_id
      ORDER BY mp.snapshot_ts DESC, mp.id DESC
      LIMIT 1
    ) latest_mp ON TRUE
    WHERE l.status = 'ACTIVE'
      AND l.marketplace_key = ${marketplaceKey}
    ORDER BY l.updated_at ASC, l.created_at ASC
    LIMIT ${limit}
  `);

  const rows = rowsResult.rows ?? [];
  let flagged = 0;
  let manualReview = 0;
  let autoPaused = 0;
  let riskSignalsTriggered = 0;

  for (const row of rows) {
    const { signals, metrics } = evaluateSignals(row, now);

    const repeatedFetchFailures = await getRecentSupplierFetchFailures({
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      windowSize: fetchFailureWindowSize,
    });

    if (repeatedFetchFailures >= fetchFailureThreshold) {
      signals.push({
        code: "LISTING_REMOVED",
        severity: "HIGH",
        message: "Supplier listing appears removed; fetch failed repeatedly.",
        meta: {
          repeated_failures: repeatedFetchFailures,
          threshold: fetchFailureThreshold,
          window_size: fetchFailureWindowSize,
        },
      });
    }

    if (signals.length === 0) {
      continue;
    }

    riskSignalsTriggered += signals.length;

    const resolution = resolveInventoryRiskAction(signals);
    const eventType =
      resolution.action === "AUTO_PAUSE"
        ? "INVENTORY_RISK_AUTO_PAUSED"
        : resolution.action === "MANUAL_REVIEW"
          ? "INVENTORY_RISK_MANUAL_REVIEW"
          : "INVENTORY_RISK_FLAGGED";

    const riskDetails = {
      action: resolution.action,
      severity: resolution.severity,
      signals,
      metrics: {
        ...metrics,
        repeated_supplier_fetch_failures: repeatedFetchFailures,
      },
      evaluatedAt: now.toISOString(),
    };

    const responsePatch = JSON.stringify({
      inventoryRisk: riskDetails,
    });

    if (resolution.action === "AUTO_PAUSE") {
      const pauseResult = await db.execute<{ id: string }>(sql`
        UPDATE listings
        SET
          status = 'PAUSED',
          response = COALESCE(response, '{}'::jsonb) || ${responsePatch}::jsonb,
          last_publish_error = ${`Inventory risk auto-paused: ${signals.map((s) => s.code).join(", ")}`},
          updated_at = NOW()
        WHERE id = ${row.listingId}
          AND status = 'ACTIVE'
        RETURNING id
      `);

      if ((pauseResult.rows?.length ?? 0) > 0) {
        autoPaused++;
      }
    } else if (resolution.action === "MANUAL_REVIEW") {
      await db.execute(sql`
        UPDATE profitable_candidates
        SET
          decision_status = 'MANUAL_REVIEW',
          listing_eligible = FALSE,
          listing_block_reason = ${`INVENTORY_RISK_MANUAL_REVIEW: ${signals
            .map((s) => s.code)
            .join(", ")}`},
          listing_eligible_ts = NOW()
        WHERE id = ${row.candidateId}
      `);

      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${responsePatch}::jsonb,
          updated_at = NOW()
        WHERE id = ${row.listingId}
      `);

      manualReview++;
    } else {
      await db.execute(sql`
        UPDATE listings
        SET
          response = COALESCE(response, '{}'::jsonb) || ${responsePatch}::jsonb,
          updated_at = NOW()
        WHERE id = ${row.listingId}
      `);

      flagged++;
    }

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "LISTING",
      entityId: row.listingId,
      eventType,
      details: {
        listingId: row.listingId,
        candidateId: row.candidateId,
        marketplaceKey: row.marketplaceKey,
        supplierKey: row.supplierKey,
        supplierProductId: row.supplierProductId,
        risk: riskDetails,
      },
    });

    if (resolution.action === "AUTO_PAUSE") {
      await writeAuditLog({
        actorType: "WORKER",
        actorId,
        entityType: "LISTING",
        entityId: row.listingId,
        eventType: "LISTING_PAUSED_INVENTORY_RISK",
        details: {
          listingId: row.listingId,
          candidateId: row.candidateId,
          marketplaceKey: row.marketplaceKey,
          supplierKey: row.supplierKey,
          supplierProductId: row.supplierProductId,
          risk: riskDetails,
        },
      });
    }
  }

  return {
    ok: true,
    marketplaceKey,
    activeListingsScanned: rows.length,
    riskFlagsTriggered: riskSignalsTriggered,
    flagged,
    manualReview,
    autoPaused,
  };
}
