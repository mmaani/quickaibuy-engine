import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export type LearningHubScorecard = {
  evidence: {
    total: number;
    pass: number;
    warn: number;
    fail: number;
  };
  openDrift: {
    total: number;
    critical: number;
    warning: number;
  };
  features: {
    total: number;
    supplierReliabilityFeatures: number;
    shippingReliabilityFeatures: number;
    stockReliabilityFeatures: number;
  };
  supplierReliability: {
    average: number | null;
    topSupplier: string | null;
    weakestSupplier: string | null;
  };
  shippingQuality: {
    passRate: number | null;
    blockedRatio: number | null;
  };
  stockQuality: {
    passRate: number | null;
    blockedRatio: number | null;
  };
  parserPerformance: Array<{
    parserVersion: string;
    events: number;
    passRate: number;
  }>;
  failureSignatures: Array<{
    reason: string;
    count: number;
  }>;
  evals: {
    pending: number;
    graded: number;
    averageGap: number | null;
  };
};

function toNumber(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function toNullable(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function getLearningHubScorecard(): Promise<LearningHubScorecard | null> {
  try {
    const [
      evidenceRes,
      driftRes,
      featureRes,
      reliabilityRes,
      shippingRes,
      stockRes,
      parserRes,
      failureRes,
      evalRes,
    ] = await Promise.all([
      db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE validation_status = 'PASS')::int AS pass,
          count(*) FILTER (WHERE validation_status = 'WARN')::int AS warn,
          count(*) FILTER (WHERE validation_status = 'FAIL')::int AS fail
        FROM learning_evidence_events
        WHERE observed_at >= now() - interval '14 days'
      `),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE status = 'OPEN')::int AS total,
          count(*) FILTER (WHERE severity = 'critical' AND status = 'OPEN')::int AS critical,
          count(*) FILTER (WHERE severity = 'warning' AND status = 'OPEN')::int AS warning
        FROM learning_drift_events
        WHERE observed_at >= now() - interval '14 days'
      `),
      db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE feature_key ILIKE 'supplier_%')::int AS supplier,
          count(*) FILTER (WHERE feature_key ILIKE 'shipping_%')::int AS shipping,
          count(*) FILTER (WHERE feature_key ILIKE 'stock_%')::int AS stock
        FROM learning_features
      `),
      db.execute(sql`
        WITH ranked AS (
          SELECT
            subject_key,
            feature_value,
            row_number() OVER (ORDER BY feature_value DESC, subject_key ASC) AS top_rank,
            row_number() OVER (ORDER BY feature_value ASC, subject_key ASC) AS low_rank
          FROM learning_features
          WHERE subject_type = 'supplier'
            AND feature_key = 'supplier_reliability_score'
        )
        SELECT
          avg(feature_value)::float AS average,
          max(CASE WHEN top_rank = 1 THEN subject_key END) AS top_supplier,
          max(CASE WHEN low_rank = 1 THEN subject_key END) AS weakest_supplier
        FROM ranked
      `),
      db.execute(sql`
        SELECT
          avg(CASE WHEN validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS pass_rate,
          avg(CASE WHEN validation_status = 'FAIL' THEN 1 ELSE 0 END)::float AS blocked_ratio
        FROM learning_evidence_events
        WHERE evidence_type = 'shipping_quote'
          AND observed_at >= now() - interval '14 days'
      `),
      db.execute(sql`
        SELECT
          avg(CASE WHEN validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS pass_rate,
          avg(CASE WHEN validation_status = 'FAIL' THEN 1 ELSE 0 END)::float AS blocked_ratio
        FROM learning_evidence_events
        WHERE evidence_type = 'stock_signal'
          AND observed_at >= now() - interval '14 days'
      `),
      db.execute(sql`
        SELECT
          coalesce(parser_version, 'unknown') AS parser_version,
          count(*)::int AS events,
          avg(CASE WHEN validation_status = 'PASS' THEN 1 ELSE 0 END)::float AS pass_rate
        FROM learning_evidence_events
        WHERE observed_at >= now() - interval '14 days'
        GROUP BY 1
        ORDER BY events DESC, parser_version ASC
        LIMIT 5
      `),
      db.execute(sql`
        SELECT
          reason,
          count(*)::int AS count
        FROM (
          SELECT unnest(blocked_reasons) AS reason
          FROM learning_evidence_events
          WHERE observed_at >= now() - interval '14 days'
            AND blocked_reasons IS NOT NULL
        ) reasons
        GROUP BY 1
        ORDER BY count DESC, reason ASC
        LIMIT 5
      `),
      db.execute(sql`
        SELECT
          count(*) FILTER (WHERE grading_status = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE grading_status = 'GRADED')::int AS graded,
          avg(quality_gap)::numeric AS average_gap
        FROM learning_eval_labels
        WHERE created_at >= now() - interval '30 days'
      `),
    ]);

    const evidenceRow = evidenceRes.rows?.[0] ?? {};
    const driftRow = driftRes.rows?.[0] ?? {};
    const featureRow = featureRes.rows?.[0] ?? {};
    const reliabilityRow = reliabilityRes.rows?.[0] ?? {};
    const shippingRow = shippingRes.rows?.[0] ?? {};
    const stockRow = stockRes.rows?.[0] ?? {};
    const evalRow = evalRes.rows?.[0] ?? {};

    return {
      evidence: {
        total: toNumber(evidenceRow.total),
        pass: toNumber(evidenceRow.pass),
        warn: toNumber(evidenceRow.warn),
        fail: toNumber(evidenceRow.fail),
      },
      openDrift: {
        total: toNumber(driftRow.total),
        critical: toNumber(driftRow.critical),
        warning: toNumber(driftRow.warning),
      },
      features: {
        total: toNumber(featureRow.total),
        supplierReliabilityFeatures: toNumber(featureRow.supplier),
        shippingReliabilityFeatures: toNumber(featureRow.shipping),
        stockReliabilityFeatures: toNumber(featureRow.stock),
      },
      supplierReliability: {
        average: toNullable(reliabilityRow.average),
        topSupplier: reliabilityRow.top_supplier ? String(reliabilityRow.top_supplier) : null,
        weakestSupplier: reliabilityRow.weakest_supplier ? String(reliabilityRow.weakest_supplier) : null,
      },
      shippingQuality: {
        passRate: toNullable(shippingRow.pass_rate),
        blockedRatio: toNullable(shippingRow.blocked_ratio),
      },
      stockQuality: {
        passRate: toNullable(stockRow.pass_rate),
        blockedRatio: toNullable(stockRow.blocked_ratio),
      },
      parserPerformance: (parserRes.rows ?? []).map((row) => ({
        parserVersion: String(row.parser_version ?? "unknown"),
        events: toNumber(row.events),
        passRate: toNumber(row.pass_rate),
      })),
      failureSignatures: (failureRes.rows ?? []).map((row) => ({
        reason: String(row.reason ?? "unknown"),
        count: toNumber(row.count),
      })),
      evals: {
        pending: toNumber(evalRow.pending),
        graded: toNumber(evalRow.graded),
        averageGap: evalRow.average_gap == null ? null : Number(evalRow.average_gap),
      },
    };
  } catch {
    return null;
  }
}
