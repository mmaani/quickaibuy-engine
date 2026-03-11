ALTER TABLE order_items
  ALTER COLUMN supplier_key DROP NOT NULL,
  ALTER COLUMN supplier_product_id DROP NOT NULL;
