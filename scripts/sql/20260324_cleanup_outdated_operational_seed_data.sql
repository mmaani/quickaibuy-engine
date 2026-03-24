BEGIN;

WITH deleted_trend_candidates AS (
  DELETE FROM trend_candidates tc
  WHERE EXISTS (
    SELECT 1
    FROM trend_signals ts
    WHERE ts.id = tc.trend_signal_id
      AND lower(coalesce(ts.source, '')) = 'manual'
      AND ts.captured_ts < now() - interval '7 days'
  )
  RETURNING tc.id
),
deleted_trend_signals AS (
  DELETE FROM trend_signals ts
  WHERE lower(coalesce(ts.source, '')) = 'manual'
    AND ts.captured_ts < now() - interval '7 days'
  RETURNING ts.id
),
deleted_products_raw AS (
  DELETE FROM products_raw pr
  WHERE pr.title ~* ' sample from '
    AND pr.snapshot_ts < now() - interval '7 days'
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
deleted_marketplace_prices AS (
  DELETE FROM marketplace_prices mp
  WHERE mp.snapshot_ts < now() - interval '7 days'
    AND NOT EXISTS (
      SELECT 1
      FROM profitable_candidates pc
      WHERE pc.market_price_snapshot_id = mp.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM matches m
      WHERE upper(coalesce(m.status, '')) = 'ACTIVE'
        AND lower(coalesce(m.marketplace_key, '')) = lower(coalesce(mp.marketplace_key, ''))
        AND coalesce(m.marketplace_listing_id, '') = coalesce(mp.marketplace_listing_id, '')
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
  'OUTDATED_DATA_CLEANUP_EXECUTED',
  jsonb_build_object(
    'deletedTrendSignals', (SELECT count(*) FROM deleted_trend_signals),
    'deletedTrendCandidates', (SELECT count(*) FROM deleted_trend_candidates),
    'deletedProductsRaw', (SELECT count(*) FROM deleted_products_raw),
    'deletedMarketplacePrices', (SELECT count(*) FROM deleted_marketplace_prices),
    'policy', jsonb_build_object(
      'trendSignals', 'manual only and older than 7 days',
      'productsRaw', 'sample rows older than 7 days, unreferenced by profitable_candidates, not tied to ACTIVE matches',
      'marketplacePrices', 'rows older than 7 days, unreferenced by profitable_candidates, not tied to ACTIVE matches'
    )
  )
);

COMMIT;