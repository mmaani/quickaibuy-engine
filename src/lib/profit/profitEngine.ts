import { sql } from "drizzle-orm";
import { db } from "../db";
import { writeAuditLog } from "../audit/writeAuditLog";

type ProfitResult = {
  scannedMatches: number;
  profitable: number;
};

type MatchRow = {
  supplier_key: string;
  supplier_product_id: string;
  marketplace_key: string;
  marketplace_listing_id: string;
  confidence: string | number | null;
};

type SupplierSnapshotRow = {
  id: string;
  title: string | null;
  price_min: string | number | null;
  price_max: string | number | null;
  shipping_estimates: unknown;
};

type MarketSnapshotRow = {
  id: string;
  matched_title: string | null;
  price: string | number | null;
};

const FEE_MODELS = {
  amazon: 0.15,
  ebay: 0.135,
  default: 0.15,
} as const;

const DEFAULT_SHIPPING = 5;
const LOW_CONFIDENCE_THRESHOLD = 0.75;
const PREFERRED_MARGIN_PCT = 20;
const PREFERRED_ROI_PCT = 25;

function normalizeRows<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

async function resolveOrderColumn(
  tableName: "products_raw" | "marketplace_prices",
  candidates: readonly string[]
): Promise<string> {
  const result = await db.execute(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
  `);

  const rows = normalizeRows<{ column_name: string }>(result);
  const set = new Set(rows.map((row) => String(row.column_name)));

  for (const candidate of candidates) {
    if (set.has(candidate)) return candidate;
  }

  return "id";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "").trim();
    if (!cleaned) return fallback;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function estimateFees(
  marketplaceKey: string,
  marketPrice: number
): { referralPct: number; estimatedFeeTotal: number } {
  const normalized = String(marketplaceKey || "").toLowerCase();
  const referralPct =
    normalized === "amazon"
      ? FEE_MODELS.amazon
      : normalized === "ebay"
        ? FEE_MODELS.ebay
        : FEE_MODELS.default;

  return {
    referralPct,
    estimatedFeeTotal: round2(marketPrice * referralPct),
  };
}

function looksLikeObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickShippingEstimate(shippingEstimates: unknown): number {
  if (shippingEstimates == null) return DEFAULT_SHIPPING;

  if (typeof shippingEstimates === "number") {
    return shippingEstimates > 0 ? shippingEstimates : DEFAULT_SHIPPING;
  }

  if (typeof shippingEstimates === "string") {
    const parsed = toNumber(shippingEstimates, DEFAULT_SHIPPING);
    return parsed > 0 ? parsed : DEFAULT_SHIPPING;
  }

  if (Array.isArray(shippingEstimates)) {
    for (const item of shippingEstimates) {
      const candidate = pickShippingEstimate(item);
      if (candidate > 0) return candidate;
    }
    return DEFAULT_SHIPPING;
  }

  if (looksLikeObject(shippingEstimates)) {
    const numericKeys = [
      "price",
      "amount",
      "cost",
      "estimate",
      "estimated",
      "shipping",
      "shippingPrice",
      "shipping_price",
      "min",
      "max",
      "value",
      "usd",
    ];

    for (const key of numericKeys) {
      if (key in shippingEstimates) {
        const n = toNumber((shippingEstimates as Record<string, unknown>)[key], 0);
        if (n > 0) return n;
      }
    }

    for (const value of Object.values(shippingEstimates)) {
      const nested = pickShippingEstimate(value);
      if (nested > 0) return nested;
    }
  }

  return DEFAULT_SHIPPING;
}

function computeRiskFlags(input: {
  confidence: number;
  supplierTitle?: string | null;
  marketTitle?: string | null;
  marginPct: number;
  roiPct: number;
}) {
  const flags: string[] = [];

  if (input.confidence < LOW_CONFIDENCE_THRESHOLD) {
    flags.push("LOW_MATCH_CONFIDENCE");
  }

  const joinedTitle = `${input.supplierTitle ?? ""} ${input.marketTitle ?? ""}`.toLowerCase();

  const brandedHints = ["nike", "adidas", "apple", "samsung", "sony", "lego", "disney", "gucci"];
  if (brandedHints.some((x) => joinedTitle.includes(x))) flags.push("BRAND_RISK");

  const riskyCategoryHints = [
    "perfume",
    "fragrance",
    "cosmetic",
    "supplement",
    "battery",
    "medical",
    "baby",
    "toy",
  ];
  if (riskyCategoryHints.some((x) => joinedTitle.includes(x))) flags.push("RISKY_CATEGORY_HINT");

  if (input.marginPct < PREFERRED_MARGIN_PCT) flags.push("LOW_MARGIN");
  if (input.roiPct < PREFERRED_ROI_PCT) flags.push("LOW_ROI");

  return flags;
}

export async function runProfitEngine(limit = 500): Promise<ProfitResult> {
  const supplierOrderColumn = await resolveOrderColumn("products_raw", [
    "snapshot_ts",
    "created_ts",
    "created_at",
    "id",
  ]);

  const marketplaceOrderColumn = await resolveOrderColumn("marketplace_prices", [
    "snapshot_ts",
    "observed_at",
    "created_at",
    "id",
  ]);

  const matchesRes = await db.execute(sql`
    SELECT
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      confidence
    FROM matches
    WHERE status = 'ACTIVE'
    ORDER BY last_seen_ts DESC
    LIMIT ${Math.max(1, Math.min(limit, 2000))}
  `);

  const matches = matchesRes.rows as MatchRow[];
  let profitable = 0;

  for (const match of matches) {
    const supplierOrderBy =
      supplierOrderColumn === "created_at"
        ? sql`created_at DESC NULLS LAST, id DESC`
        : supplierOrderColumn === "created_ts"
          ? sql`created_ts DESC NULLS LAST, id DESC`
          : supplierOrderColumn === "id"
            ? sql`id DESC`
            : sql`snapshot_ts DESC NULLS LAST, id DESC`;

    const marketplaceOrderBy =
      marketplaceOrderColumn === "observed_at"
        ? sql`observed_at DESC NULLS LAST, id DESC`
        : marketplaceOrderColumn === "created_at"
          ? sql`created_at DESC NULLS LAST, id DESC`
          : marketplaceOrderColumn === "id"
            ? sql`id DESC`
            : sql`snapshot_ts DESC NULLS LAST, id DESC`;

    const supplierRes = await db.execute(sql`
      SELECT id, title, price_min, price_max, shipping_estimates
      FROM products_raw
      WHERE supplier_key = ${match.supplier_key}
        AND supplier_product_id = ${match.supplier_product_id}
      ORDER BY ${supplierOrderBy}
      LIMIT 1
    `);

    const marketRes = await db.execute(sql`
      SELECT id, matched_title, price
      FROM marketplace_prices
      WHERE marketplace_key = ${match.marketplace_key}
        AND marketplace_listing_id = ${match.marketplace_listing_id}
      ORDER BY ${marketplaceOrderBy}
      LIMIT 1
    `);

    if (!supplierRes.rows.length || !marketRes.rows.length) continue;

    const s = supplierRes.rows[0] as SupplierSnapshotRow;
    const m = marketRes.rows[0] as MarketSnapshotRow;

    const estimatedCogs = round2(toNumber(s.price_min, 0) > 0 ? toNumber(s.price_min, 0) : toNumber(s.price_max, 0));
    const estimatedShipping = round2(pickShippingEstimate(s.shipping_estimates));
    const marketPrice = round2(toNumber(m.price, 0));

    if (estimatedCogs <= 0 || marketPrice <= 0) continue;

    const feeModel = estimateFees(match.marketplace_key, marketPrice);
    const estimatedFees = feeModel.estimatedFeeTotal;
    const estimatedProfit = round2(marketPrice - estimatedFees - estimatedShipping - estimatedCogs);

    if (estimatedProfit <= 0) continue;

    const marginPct = marketPrice > 0 ? round2((estimatedProfit / marketPrice) * 100) : 0;
    const roiBase = estimatedCogs + estimatedShipping;
    const roiPct = roiBase > 0 ? round2((estimatedProfit / roiBase) * 100) : 0;

    const riskFlags = computeRiskFlags({
      confidence: toNumber(match.confidence, 0),
      supplierTitle: s.title,
      marketTitle: m.matched_title,
      marginPct,
      roiPct,
    });

    const reason = [
      "auto-evaluated",
      marginPct >= PREFERRED_MARGIN_PCT ? "margin_ok" : "margin_below_preferred",
      roiPct >= PREFERRED_ROI_PCT ? "roi_ok" : "roi_below_preferred",
    ].join("; ");

    const exists = await db.execute(sql`
      SELECT 1
      FROM profitable_candidates
      WHERE supplier_snapshot_id = ${s.id}
        AND market_price_snapshot_id = ${m.id}
      LIMIT 1
    `);

    if (exists.rows.length) continue;

    await db.execute(sql`
      INSERT INTO profitable_candidates (
        id,
        supplier_key,
        supplier_product_id,
        marketplace_key,
        marketplace_listing_id,
        calc_ts,
        supplier_snapshot_id,
        market_price_snapshot_id,
        estimated_fees,
        estimated_shipping,
        estimated_cogs,
        estimated_profit,
        margin_pct,
        roi_pct,
        risk_flags,
        decision_status,
        reason
      )
      VALUES (
        gen_random_uuid(),
        ${match.supplier_key},
        ${match.supplier_product_id},
        ${match.marketplace_key},
        ${match.marketplace_listing_id},
        NOW(),
        ${s.id},
        ${m.id},
        ${JSON.stringify({
          marketplace: match.marketplace_key,
          referralPct: feeModel.referralPct,
          estimatedFeeTotal: estimatedFees,
        })}::jsonb,
        ${String(estimatedShipping)},
        ${String(estimatedCogs)},
        ${String(estimatedProfit)},
        ${String(marginPct)},
        ${String(roiPct)},
        ${riskFlags},
        'PENDING',
        ${reason}
      )
    `);

    profitable += 1;

    await writeAuditLog({
      actorType: "WORKER",
      actorId: "profit-engine",
      entityType: "PROFITABLE_CANDIDATE",
      entityId: `${match.supplier_key}:${match.supplier_product_id}:${match.marketplace_key}:${match.marketplace_listing_id}`,
      eventType: "INSERTED",
      details: {
        supplierSnapshotId: s.id,
        marketPriceSnapshotId: m.id,
        estimatedProfit,
        marginPct,
        roiPct,
        riskFlags,
        decisionStatus: "PENDING",
      },
    });
  }

  await writeAuditLog({
    actorType: "WORKER",
    actorId: "profit-engine",
    entityType: "PROFIT_ENGINE",
    entityId: "run",
    eventType: "COMPLETED",
    details: {
      scannedMatches: matches.length,
      profitable,
      feeModels: FEE_MODELS,
      thresholds: {
        marginPct: PREFERRED_MARGIN_PCT,
        roiPct: PREFERRED_ROI_PCT,
      },
    },
  });

  return {
    scannedMatches: matches.length,
    profitable,
  };
}
