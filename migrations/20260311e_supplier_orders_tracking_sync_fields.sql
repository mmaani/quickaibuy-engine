ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS tracking_sync_last_attempt_at timestamp,
  ADD COLUMN IF NOT EXISTS tracking_synced_at timestamp,
  ADD COLUMN IF NOT EXISTS tracking_sync_error text,
  ADD COLUMN IF NOT EXISTS tracking_sync_last_response jsonb;
