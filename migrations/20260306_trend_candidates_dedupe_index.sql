BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_trend_candidates_signal_type_value_region
ON trend_candidates (
  trend_signal_id,
  candidate_type,
  lower(trim(candidate_value)),
  coalesce(region, '')
);

COMMIT;
