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
};

function classifySeverity(deltaRatio: number): DriftSeverity {
  const abs = Math.abs(deltaRatio);
  if (abs >= 0.35) return "critical";
  if (abs >= 0.2) return "warning";
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
  const deltaRatio = delta / denominator;
  const severity = classifySeverity(deltaRatio);
  const reasonCode = reasonCodeFor(input.category, severity);
  const actionHint =
    severity === "critical"
      ? "Pause candidate progression and prioritize evidence refresh for this segment."
      : severity === "warning"
        ? "Deprioritize weak suppliers and increase manual review focus."
        : "Track trend and continue monitoring.";

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
      ${JSON.stringify({ deltaRatio, sampleSize: input.sampleSize })}::jsonb,
      now()
    )
  `);

  return { severity, reasonCode, actionHint, deltaRatio };
}
