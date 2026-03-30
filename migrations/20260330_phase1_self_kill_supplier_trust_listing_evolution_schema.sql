ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS performance_impressions bigint,
  ADD COLUMN IF NOT EXISTS performance_clicks bigint,
  ADD COLUMN IF NOT EXISTS performance_orders bigint,
  ADD COLUMN IF NOT EXISTS performance_ctr numeric(8,6),
  ADD COLUMN IF NOT EXISTS performance_conversion_rate numeric(8,6),
  ADD COLUMN IF NOT EXISTS performance_last_signal_at timestamp,
  ADD COLUMN IF NOT EXISTS kill_score numeric(8,6),
  ADD COLUMN IF NOT EXISTS kill_decision text,
  ADD COLUMN IF NOT EXISTS kill_reason_codes text[],
  ADD COLUMN IF NOT EXISTS kill_evaluated_at timestamp,
  ADD COLUMN IF NOT EXISTS auto_killed_at timestamp,
  ADD COLUMN IF NOT EXISTS evolution_attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_evolution_at timestamp,
  ADD COLUMN IF NOT EXISTS listing_evolution_status text,
  ADD COLUMN IF NOT EXISTS listing_evolution_reason text,
  ADD COLUMN IF NOT EXISTS listing_evolution_candidate_payload jsonb,
  ADD COLUMN IF NOT EXISTS listing_evolution_applied_at timestamp,
  ADD COLUMN IF NOT EXISTS listing_evolution_result text;

CREATE INDEX IF NOT EXISTS listings_kill_decision_evaluated_idx
  ON listings (kill_decision, kill_evaluated_at);

CREATE INDEX IF NOT EXISTS listings_evolution_status_last_evolution_idx
  ON listings (listing_evolution_status, last_evolution_at);

ALTER TABLE profitable_candidates
  ADD COLUMN IF NOT EXISTS supplier_trust_score numeric(8,6),
  ADD COLUMN IF NOT EXISTS supplier_trust_band text,
  ADD COLUMN IF NOT EXISTS supplier_delivery_score numeric(8,6),
  ADD COLUMN IF NOT EXISTS supplier_stock_score numeric(8,6),
  ADD COLUMN IF NOT EXISTS supplier_price_stability_score numeric(8,6),
  ADD COLUMN IF NOT EXISTS supplier_issue_penalty numeric(8,6),
  ADD COLUMN IF NOT EXISTS supplier_trust_evaluated_at timestamp,
  ADD COLUMN IF NOT EXISTS supplier_trust_reason_codes text[];

CREATE INDEX IF NOT EXISTS profitable_candidates_supplier_trust_band_score_idx
  ON profitable_candidates (supplier_trust_band, supplier_trust_score DESC);

CREATE INDEX IF NOT EXISTS profitable_candidates_supplier_trust_evaluated_idx
  ON profitable_candidates (supplier_trust_evaluated_at);
