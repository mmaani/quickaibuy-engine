ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS supplier_key text,
  ADD COLUMN IF NOT EXISTS supplier_product_id text,
  ADD COLUMN IF NOT EXISTS linkage_source text,
  ADD COLUMN IF NOT EXISTS linkage_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS linkage_deterministic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_link_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_stock_status text,
  ADD COLUMN IF NOT EXISTS supplier_stock_qty integer,
  ADD COLUMN IF NOT EXISTS stock_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS stock_source text,
  ADD COLUMN IF NOT EXISTS stock_check_required boolean NOT NULL DEFAULT true;

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS linkage_source text,
  ADD COLUMN IF NOT EXISTS linkage_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS linkage_deterministic boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_link_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supplier_stock_status text,
  ADD COLUMN IF NOT EXISTS supplier_stock_qty integer,
  ADD COLUMN IF NOT EXISTS stock_verified_at timestamp,
  ADD COLUMN IF NOT EXISTS stock_source text,
  ADD COLUMN IF NOT EXISTS stock_check_required boolean NOT NULL DEFAULT true;

UPDATE listings l
SET
  supplier_key = COALESCE(NULLIF(BTRIM(l.supplier_key), ''), NULLIF(BTRIM(pc.supplier_key), ''), NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierKey'), '')),
  supplier_product_id = COALESCE(NULLIF(BTRIM(l.supplier_product_id), ''), NULLIF(BTRIM(pc.supplier_product_id), ''), NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierProductId'), '')),
  linkage_source = COALESCE(NULLIF(BTRIM(l.linkage_source), ''), 'candidate_snapshot'),
  linkage_verified_at = COALESCE(l.linkage_verified_at, NOW()),
  linkage_deterministic = COALESCE(l.linkage_deterministic, false) OR (
    COALESCE(NULLIF(BTRIM(l.supplier_key), ''), NULLIF(BTRIM(pc.supplier_key), ''), NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierKey'), '')) IS NOT NULL
    AND COALESCE(NULLIF(BTRIM(l.supplier_product_id), ''), NULLIF(BTRIM(pc.supplier_product_id), ''), NULLIF(BTRIM(l.payload -> 'source' ->> 'supplierProductId'), '')) IS NOT NULL
  ),
  supplier_link_locked = CASE
    WHEN l.status IN ('READY_TO_PUBLISH', 'PUBLISH_IN_PROGRESS', 'ACTIVE', 'PAUSED', 'PAUSED_MANUAL_REVIEW') THEN true
    ELSE COALESCE(l.supplier_link_locked, false)
  END,
  stock_verified_at = COALESCE(l.stock_verified_at, pr.snapshot_ts),
  stock_source = COALESCE(NULLIF(BTRIM(l.stock_source), ''), 'products_raw_snapshot')
FROM profitable_candidates pc
LEFT JOIN LATERAL (
  SELECT pr.snapshot_ts
  FROM products_raw pr
  WHERE LOWER(pr.supplier_key) = LOWER(COALESCE(NULLIF(BTRIM(l.supplier_key), ''), NULLIF(BTRIM(pc.supplier_key), '')))
    AND pr.supplier_product_id = COALESCE(NULLIF(BTRIM(l.supplier_product_id), ''), NULLIF(BTRIM(pc.supplier_product_id), ''))
  ORDER BY pr.snapshot_ts DESC, pr.id DESC
  LIMIT 1
) pr ON TRUE
WHERE l.candidate_id = pc.id;

UPDATE order_items oi
SET
  linkage_source = COALESCE(NULLIF(BTRIM(oi.linkage_source), ''), 'order_sync'),
  linkage_verified_at = COALESCE(oi.linkage_verified_at, NOW()),
  linkage_deterministic = COALESCE(oi.linkage_deterministic, false) OR (
    NULLIF(BTRIM(oi.supplier_key), '') IS NOT NULL
    AND NULLIF(BTRIM(oi.supplier_product_id), '') IS NOT NULL
  ),
  supplier_link_locked = COALESCE(oi.supplier_link_locked, false) OR (
    NULLIF(BTRIM(oi.supplier_key), '') IS NOT NULL
    AND NULLIF(BTRIM(oi.supplier_product_id), '') IS NOT NULL
  ),
  stock_source = COALESCE(NULLIF(BTRIM(oi.stock_source), ''), 'order_sync_snapshot')
WHERE TRUE;
