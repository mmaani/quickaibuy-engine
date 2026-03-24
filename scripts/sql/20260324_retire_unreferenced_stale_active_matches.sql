BEGIN;

WITH stale_matches AS (
  SELECT
    m.id,
    m.supplier_key,
    m.supplier_product_id,
    m.marketplace_key,
    m.marketplace_listing_id
  FROM matches m
  WHERE upper(coalesce(m.status, '')) = 'ACTIVE'
    AND m.last_seen_ts < now() - interval '7 days'
),
protected_profit_candidates AS (
  SELECT DISTINCT
    lower(coalesce(pc.supplier_key, '')) AS supplier_key,
    coalesce(pc.supplier_product_id, '') AS supplier_product_id,
    lower(coalesce(pc.marketplace_key, '')) AS marketplace_key,
    coalesce(pc.marketplace_listing_id, '') AS marketplace_listing_id
  FROM profitable_candidates pc
),
protected_listings AS (
  SELECT DISTINCT
    lower(coalesce(pc.supplier_key, '')) AS supplier_key,
    coalesce(pc.supplier_product_id, '') AS supplier_product_id,
    lower(coalesce(pc.marketplace_key, '')) AS marketplace_key,
    coalesce(pc.marketplace_listing_id, '') AS marketplace_listing_id
  FROM profitable_candidates pc
  JOIN listings l
    ON l.candidate_id = pc.id
),
retired_matches AS (
  UPDATE matches m
  SET status = 'INACTIVE'
  WHERE m.id IN (
    SELECT sm.id
    FROM stale_matches sm
    WHERE NOT EXISTS (
      SELECT 1
      FROM protected_profit_candidates ppc
      WHERE ppc.supplier_key = lower(coalesce(sm.supplier_key, ''))
        AND ppc.supplier_product_id = coalesce(sm.supplier_product_id, '')
        AND ppc.marketplace_key = lower(coalesce(sm.marketplace_key, ''))
        AND ppc.marketplace_listing_id = coalesce(sm.marketplace_listing_id, '')
    )
      AND NOT EXISTS (
        SELECT 1
        FROM protected_listings pl
        WHERE pl.supplier_key = lower(coalesce(sm.supplier_key, ''))
          AND pl.supplier_product_id = coalesce(sm.supplier_product_id, '')
          AND pl.marketplace_key = lower(coalesce(sm.marketplace_key, ''))
          AND pl.marketplace_listing_id = coalesce(sm.marketplace_listing_id, '')
      )
  )
  RETURNING m.id
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
  'STALE_MATCH_RETIREMENT_EXECUTED',
  jsonb_build_object(
    'retiredMatches', (SELECT count(*) FROM retired_matches),
    'policy', jsonb_build_object(
      'matches', 'ACTIVE only, last_seen older than 7 days, unreferenced by profitable_candidates and listings'
    )
  )
);

COMMIT;
