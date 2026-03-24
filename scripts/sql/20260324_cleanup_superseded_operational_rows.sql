BEGIN;

WITH deleted_seed_supplier_rows AS (
  DELETE FROM products_raw pr
  WHERE pr.snapshot_ts < now() - interval '7 days'
    AND pr.source_url LIKE 'https://%.example/%'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.supplier_snapshot_id = pr.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM matches m
      WHERE upper(coalesce(m.status, '')) = 'ACTIVE'
        AND lower(coalesce(m.supplier_key, '')) = lower(coalesce(pr.supplier_key, ''))
        AND coalesce(m.supplier_product_id, '') = coalesce(pr.supplier_product_id, '')
    )
  RETURNING pr.id
),
deleted_superseded_supplier_rows AS (
  DELETE FROM products_raw pr
  WHERE pr.snapshot_ts < now() - interval '48 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.supplier_snapshot_id = pr.id
    )
    AND EXISTS (
      SELECT 1
      FROM products_raw newer
      WHERE lower(coalesce(newer.supplier_key, '')) = lower(coalesce(pr.supplier_key, ''))
        AND coalesce(newer.supplier_product_id, '') = coalesce(pr.supplier_product_id, '')
        AND newer.snapshot_ts > pr.snapshot_ts
        AND newer.snapshot_ts >= now() - interval '48 hours'
    )
  RETURNING pr.id
),
deleted_superseded_marketplace_rows AS (
  DELETE FROM marketplace_prices mp
  WHERE lower(coalesce(mp.marketplace_key, '')) = 'ebay'
    AND mp.snapshot_ts < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.market_price_snapshot_id = mp.id
    )
    AND EXISTS (
      SELECT 1
      FROM marketplace_prices newer
      WHERE lower(coalesce(newer.marketplace_key, '')) = lower(coalesce(mp.marketplace_key, ''))
        AND coalesce(newer.marketplace_listing_id, '') = coalesce(mp.marketplace_listing_id, '')
        AND newer.snapshot_ts > mp.snapshot_ts
        AND newer.snapshot_ts >= now() - interval '24 hours'
    )
  RETURNING mp.id
)
INSERT INTO audit_log (
  actor_type,
  actor_id,
  entity_type,
  entity_id,
  event_type,
  details
)
VALUES (
  'ADMIN',
  'codex-cleanup-20260324',
  'PIPELINE',
  'production-db',
  'SUPERSEDED_OPERATIONAL_ROWS_CLEANUP_EXECUTED',
  jsonb_build_object(
    'deletedSeedSupplierRows', (SELECT count(*) FROM deleted_seed_supplier_rows),
    'deletedSupersededSupplierRows', (SELECT count(*) FROM deleted_superseded_supplier_rows),
    'deletedSupersededMarketplaceRows', (SELECT count(*) FROM deleted_superseded_marketplace_rows),
    'policy', jsonb_build_object(
      'seedSupplierRows', 'example-domain seed rows older than 7 days, unreferenced, and no active match',
      'supersededSupplierRows', 'supplier snapshots older than 48 hours that have a newer fresh snapshot for the same supplier product and no profitable candidate reference',
      'supersededMarketplaceRows', 'eBay marketplace snapshots older than 24 hours that have a newer fresh snapshot for the same listing and no profitable candidate reference'
    )
  )
);

COMMIT;
