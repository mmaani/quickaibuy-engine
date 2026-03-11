CREATE TABLE IF NOT EXISTS manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_key text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  note text,
  changed_by text,
  changed_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS manual_overrides_control_key_unique
  ON manual_overrides (control_key);

CREATE INDEX IF NOT EXISTS manual_overrides_changed_at_idx
  ON manual_overrides (changed_at DESC);
