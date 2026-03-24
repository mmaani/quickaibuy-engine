BEGIN;

WITH seed_rows AS (
  SELECT
    pr.id,
    lower(coalesce(pr.supplier_key, '')) AS supplier_key_norm,
    coalesce(pr.supplier_product_id, '') AS supplier_product_id_norm
  FROM products_raw pr
  WHERE pr.snapshot_ts < now() - interval '7 days'
    AND pr.source_url LIKE 'https://%.example/%'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.supplier_snapshot_id = pr.id
    )
),
retired_seed_matches AS (
  UPDATE matches m
  SET status = 'INACTIVE'
  WHERE upper(coalesce(m.status, '')) = 'ACTIVE'
    AND EXISTS (
      SELECT 1
      FROM seed_rows sr
      WHERE sr.supplier_key_norm = lower(coalesce(m.supplier_key, ''))
        AND sr.supplier_product_id_norm = coalesce(m.supplier_product_id, '')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE lower(coalesce(pc.supplier_key, '')) = lower(coalesce(m.supplier_key, ''))
        AND coalesce(pc.supplier_product_id, '') = coalesce(m.supplier_product_id, '')
        AND lower(coalesce(pc.marketplace_key, '')) = lower(coalesce(m.marketplace_key, ''))
        AND coalesce(pc.marketplace_listing_id, '') = coalesce(m.marketplace_listing_id, '')
    )
  RETURNING m.id
),
deleted_seed_rows AS (
  DELETE FROM products_raw pr
  WHERE EXISTS (
      SELECT 1
      FROM seed_rows sr
      WHERE sr.id = pr.id
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
deleted_orphan_marketplace_rows AS (
  DELETE FROM marketplace_prices mp
  WHERE lower(coalesce(mp.marketplace_key, '')) = 'ebay'
    AND mp.snapshot_ts < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.market_price_snapshot_id = mp.id
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
  'ORPHAN_SEED_AND_MARKETPLACE_ROWS_CLEANUP_EXECUTED',
  jsonb_build_object(
    'retiredSeedMatches', (SELECT count(*) FROM retired_seed_matches),
    'deletedSeedRows', (SELECT count(*) FROM deleted_seed_rows),
    'deletedOrphanMarketplaceRows', (SELECT count(*) FROM deleted_orphan_marketplace_rows),
    'policy', jsonb_build_object(
      'seedMatches', 'ACTIVE matches tied only to example-domain seed supplier rows with no profitable candidate reference are retired',
      'seedRows', 'example-domain supplier rows older than 7 days are deleted after active seed matches are retired',
      'marketplaceRows', 'unreferenced stale eBay marketplace rows older than 24 hours are deleted'
    )
  )
);

COMMIT;
