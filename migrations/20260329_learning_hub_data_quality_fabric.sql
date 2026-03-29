CREATE TABLE IF NOT EXISTS learning_evidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  supplier_key text,
  marketplace_key text,
  source text NOT NULL,
  parser_version text,
  confidence numeric(6,4),
  freshness_seconds integer,
  validation_status text NOT NULL,
  blocked_reasons text[] NOT NULL DEFAULT '{}',
  downstream_outcome text,
  diagnostics jsonb,
  observed_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_evidence_events_type_time_idx
  ON learning_evidence_events (evidence_type, observed_at DESC);
CREATE INDEX IF NOT EXISTS learning_evidence_events_entity_idx
  ON learning_evidence_events (entity_type, entity_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS learning_evidence_events_supplier_idx
  ON learning_evidence_events (supplier_key, observed_at DESC);

CREATE TABLE IF NOT EXISTS learning_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key text NOT NULL,
  subject_type text NOT NULL,
  subject_key text NOT NULL,
  feature_value numeric(12,6),
  confidence numeric(6,4),
  sample_size integer NOT NULL DEFAULT 0,
  trend_direction text,
  evidence_window_start timestamp,
  evidence_window_end timestamp,
  metadata jsonb,
  updated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (feature_key, subject_type, subject_key)
);

CREATE INDEX IF NOT EXISTS learning_features_subject_idx
  ON learning_features (subject_type, subject_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS learning_metric_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  segment_key text NOT NULL DEFAULT 'global',
  metric_value numeric(12,6) NOT NULL,
  sample_size integer NOT NULL DEFAULT 0,
  snapshot_ts timestamp NOT NULL DEFAULT now(),
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_metric_snapshots_lookup_idx
  ON learning_metric_snapshots (metric_key, segment_key, snapshot_ts DESC);

CREATE TABLE IF NOT EXISTS learning_drift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_key text NOT NULL,
  segment_key text NOT NULL DEFAULT 'global',
  category text NOT NULL,
  severity text NOT NULL,
  baseline_value numeric(12,6),
  observed_value numeric(12,6),
  delta_value numeric(12,6),
  reason_code text NOT NULL,
  action_hint text,
  status text NOT NULL DEFAULT 'OPEN',
  diagnostics jsonb,
  observed_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_drift_events_open_idx
  ON learning_drift_events (status, severity, observed_at DESC);

CREATE TABLE IF NOT EXISTS learning_eval_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  predicted_label text,
  predicted_confidence numeric(6,4),
  observed_label text,
  observed_confidence numeric(6,4),
  quality_gap numeric(8,4),
  grading_status text NOT NULL DEFAULT 'PENDING',
  grading_notes text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_eval_labels_lookup_idx
  ON learning_eval_labels (label_type, grading_status, updated_at DESC);
