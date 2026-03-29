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

export async function getLearningHubScorecard(): Promise<LearningHubScorecard | null> {
  try {
    const [evidenceRes, driftRes, featureRes, evalRes] = await Promise.all([
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
          count(*)::int AS total,
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
