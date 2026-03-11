ALTER TABLE supplier_orders
  ADD COLUMN IF NOT EXISTS tracking_carrier text;
