import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { evaluateEvidenceContracts } from "@/lib/learningHub/contracts";
import type { LearningEvidenceRecord } from "@/lib/learningHub/types";

type FeatureUpsertInput = {
  featureKey: string;
  subjectType: string;
  subjectKey: string;
  featureValue: number;
  confidence?: number;
  sampleSize?: number;
  trendDirection?: "up" | "down" | "flat";
  metadata?: Record<string, unknown>;
};

export async function recordLearningEvidence(input: LearningEvidenceRecord) {
  const assessed = evaluateEvidenceContracts(input);
  await db.execute(sql`
    INSERT INTO learning_evidence_events (
      evidence_type,
      entity_type,
      entity_id,
      supplier_key,
      marketplace_key,
      source,
      parser_version,
      confidence,
      freshness_seconds,
      validation_status,
      blocked_reasons,
      downstream_outcome,
      diagnostics,
      observed_at
    ) VALUES (
      ${input.evidenceType},
      ${input.entityType},
      ${input.entityId},
      ${input.supplierKey ?? null},
      ${input.marketplaceKey ?? null},
      ${input.source},
      ${input.parserVersion ?? null},
      ${input.confidence ?? null},
      ${input.freshnessSeconds ?? null},
      ${assessed.status},
      ${assessed.blockedReasons},
      ${input.downstreamOutcome ?? null},
      ${input.diagnostics ?? null},
      ${input.observedAt ?? new Date()}
    )
  `);

  return assessed;
}

export async function upsertLearningFeature(input: FeatureUpsertInput) {
  await db.execute(sql`
    INSERT INTO learning_features (
      feature_key,
      subject_type,
      subject_key,
      feature_value,
      confidence,
      sample_size,
      trend_direction,
      metadata,
      evidence_window_end,
      updated_at
    )
    VALUES (
      ${input.featureKey},
      ${input.subjectType},
      ${input.subjectKey},
      ${input.featureValue},
      ${input.confidence ?? null},
      ${input.sampleSize ?? 0},
      ${input.trendDirection ?? null},
      ${input.metadata ?? null},
      now(),
      now()
    )
    ON CONFLICT (feature_key, subject_type, subject_key)
    DO UPDATE SET
      feature_value = EXCLUDED.feature_value,
      confidence = EXCLUDED.confidence,
      sample_size = EXCLUDED.sample_size,
      trend_direction = EXCLUDED.trend_direction,
      metadata = EXCLUDED.metadata,
      evidence_window_end = EXCLUDED.evidence_window_end,
      updated_at = now()
  `);
}
