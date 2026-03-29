import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { DriftCategory, DriftSeverity } from "@/lib/learningHub/types";

type DriftInput = {
  metricKey: string;
  segmentKey?: string;
  category: DriftCategory;
  baselineValue: number;
  observedValue: number;
  sampleSize: number;
  worseWhen?: "higher" | "lower";
};

function classifySeverity(deltaRatio: number): DriftSeverity {
  if (deltaRatio >= 0.35) return "critical";
  if (deltaRatio >= 0.2) return "warning";
  return "info";
}

function reasonCodeFor(category: DriftCategory, severity: DriftSeverity): string {
  return `${category.toUpperCase()}:${severity.toUpperCase()}`;
}

export async function recordMetricSnapshot(input: {
  metricKey: string;
  segmentKey?: string;
  metricValue: number;
  sampleSize?: number;
  metadata?: Record<string, unknown>;
}) {
  await db.execute(sql`
    INSERT INTO learning_metric_snapshots (
      metric_key,
      segment_key,
      metric_value,
      sample_size,
      metadata,
      snapshot_ts
    ) VALUES (
      ${input.metricKey},
      ${input.segmentKey ?? "global"},
      ${input.metricValue},
      ${input.sampleSize ?? 0},
      ${input.metadata ?? null},
      now()
    )
  `);
}

export async function recordDriftEvent(input: DriftInput) {
  const segmentKey = input.segmentKey ?? "global";
  const baseline = input.baselineValue;
  const observed = input.observedValue;
  const delta = observed - baseline;
  const denominator = Math.max(Math.abs(baseline), 0.0001);
  const direction = input.worseWhen ?? "higher";
  const worseningDelta = direction === "lower" ? baseline - observed : observed - baseline;
  const deltaRatio = worseningDelta / denominator;
  const severity = classifySeverity(deltaRatio);
  const reasonCode = reasonCodeFor(input.category, severity);
  const actionHint =
    severity === "critical"
      ? "Pause candidate progression and prioritize evidence refresh for this segment."
      : severity === "warning"
        ? "Deprioritize weak suppliers and increase manual review focus."
        : "Metric recovered within tolerance; keep monitoring.";
  const status = severity === "info" ? "RESOLVED" : "OPEN";

  await db.execute(sql`
    UPDATE learning_drift_events
    SET status = 'RESOLVED'
    WHERE metric_key = ${input.metricKey}
      AND segment_key = ${segmentKey}
      AND category = ${input.category}
      AND status = 'OPEN'
  `);

  await db.execute(sql`
    INSERT INTO learning_drift_events (
      metric_key,
      segment_key,
      category,
      severity,
      baseline_value,
      observed_value,
      delta_value,
      reason_code,
      action_hint,
      status,
      diagnostics,
      observed_at
    ) VALUES (
      ${input.metricKey},
      ${segmentKey},
      ${input.category},
      ${severity},
      ${baseline},
      ${observed},
      ${delta},
      ${reasonCode},
      ${actionHint},
      ${status},
      ${JSON.stringify({ deltaRatio, sampleSize: input.sampleSize })}::jsonb,
      now()
    )
  `);

  return { severity, reasonCode, actionHint, deltaRatio };
}
