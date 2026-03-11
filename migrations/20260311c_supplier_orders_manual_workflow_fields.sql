ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS manual_note text,
  ADD COLUMN IF NOT EXISTS purchase_recorded_at timestamp,
  ADD COLUMN IF NOT EXISTS tracking_recorded_at timestamp;
