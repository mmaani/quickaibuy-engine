import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

export async function recordEvalLabel(input: {
  labelType: string;
  entityType: string;
  entityId: string;
  predictedLabel?: string;
  predictedConfidence?: number;
  observedLabel?: string;
  observedConfidence?: number;
  gradingNotes?: string;
}) {
  const qualityGap =
    input.predictedConfidence != null && input.observedConfidence != null
      ? Number((input.observedConfidence - input.predictedConfidence).toFixed(4))
      : null;

  await db.execute(sql`
    INSERT INTO learning_eval_labels (
      label_type,
      entity_type,
      entity_id,
      predicted_label,
      predicted_confidence,
      observed_label,
      observed_confidence,
      quality_gap,
      grading_status,
      grading_notes,
      updated_at
    ) VALUES (
      ${input.labelType},
      ${input.entityType},
      ${input.entityId},
      ${input.predictedLabel ?? null},
      ${input.predictedConfidence ?? null},
      ${input.observedLabel ?? null},
      ${input.observedConfidence ?? null},
      ${qualityGap},
      ${input.observedLabel ? "GRADED" : "PENDING"},
      ${input.gradingNotes ?? null},
      now()
    )
  `);

  return { qualityGap };
}
