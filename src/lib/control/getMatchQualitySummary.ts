import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

type Row = Record<string, unknown>;

export type MatchQualitySummary = {
  totalMatches: number | null;
  activeMatches: number | null;
  inactiveMatches: number | null;
  confidenceDistribution: Array<{ bucket: string; count: number | null }>;
  lowConfidenceCount: number | null;
  lowConfidenceAcceptedMatches: number | null;
  borderlineAcceptedMatches: number | null;
  duplicatePairCount: number | null;
  weakMatchCount: number | null;
  weakMatchReasons: Row[];
  duplicatePatterns: Row[];
  supplierKeyConsistency: {
    invalidKeyCount: number | null;
    nonCanonicalKeyCount: number | null;
    inconsistentGroups: Row[];
  };
};

function normalizeRows(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? (rows as Row[]) : [];
  }
  return [];
}

async function runQuery(query: string): Promise<Row[]> {
  const result = await db.execute(sql.raw(query));
  return normalizeRows(result);
}

function toNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export async function getMatchQualitySummary(input?: {
  matchesExists?: boolean;
  matchesHasStatus?: boolean;
  matchesHasConfidence?: boolean;
}): Promise<MatchQualitySummary> {
  const matchesExists = input?.matchesExists ?? true;
  const matchesHasStatus = input?.matchesHasStatus ?? true;
  const matchesHasConfidence = input?.matchesHasConfidence ?? true;

  if (!matchesExists) {
    return {
      totalMatches: null,
      activeMatches: null,
      inactiveMatches: null,
      confidenceDistribution: [],
      lowConfidenceCount: null,
      lowConfidenceAcceptedMatches: null,
      borderlineAcceptedMatches: null,
      duplicatePairCount: null,
      weakMatchCount: null,
      weakMatchReasons: [],
      duplicatePatterns: [],
      supplierKeyConsistency: {
        invalidKeyCount: null,
        nonCanonicalKeyCount: null,
        inconsistentGroups: [],
      },
    };
  }

  const totalMatches = toNum((await runQuery(`select count(*)::int as count from matches`))[0]?.count);
  const activeMatches = matchesHasStatus
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where upper(coalesce(status, '')) = 'ACTIVE'
          `)
        )[0]?.count
      )
    : null;
  const inactiveMatches =
    totalMatches != null && activeMatches != null ? Math.max(0, totalMatches - activeMatches) : null;

  const confidenceDistribution = matchesHasConfidence
    ? (
        await runQuery(`
          select bucket, count
          from (
            select
              case
                when confidence::numeric < 0.75 then 'low (<0.75)'
                when confidence::numeric < 0.90 then 'medium (0.75-0.89)'
                else 'high (>=0.90)'
              end as bucket,
              count(*)::int as count
            from matches
            group by 1
          ) bands
          order by
            case
              when bucket = 'low (<0.75)' then 1
              when bucket = 'medium (0.75-0.89)' then 2
              else 3
            end
        `)
      ).map((row) => ({
        bucket: toStr(row.bucket) ?? "-",
        count: toNum(row.count),
      }))
    : [];

  const lowConfidenceCount = matchesHasConfidence
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where confidence::numeric < 0.75
          `)
        )[0]?.count
      )
    : null;

  const lowConfidenceAcceptedMatches = matchesHasConfidence && matchesHasStatus
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where upper(coalesce(status, '')) = 'ACTIVE'
              and confidence::numeric < 0.75
          `)
        )[0]?.count
      )
    : null;

  const borderlineAcceptedMatches = matchesHasConfidence && matchesHasStatus
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where upper(coalesce(status, '')) = 'ACTIVE'
              and confidence::numeric >= 0.75
              and confidence::numeric < 0.80
          `)
        )[0]?.count
      )
    : null;

  const duplicatePairCount = toNum(
    (
      await runQuery(`
        select count(*)::int as count
        from (
          select supplier_key, supplier_product_id, marketplace_key, marketplace_listing_id
          from matches
          group by 1,2,3,4
          having count(*) > 1
        ) dup
      `)
    )[0]?.count
  );

  const duplicatePatterns = await runQuery(`
    select
      supplier_key,
      supplier_product_id,
      marketplace_key,
      marketplace_listing_id,
      count(*)::int as duplicate_count,
      round(avg(confidence)::numeric, 4) as avg_confidence
    from matches
    group by 1,2,3,4
    having count(*) > 1
    order by duplicate_count desc, avg_confidence asc nulls last
    limit 15
  `);

  const weakMatchCount = matchesHasConfidence
    ? toNum(
        (
          await runQuery(`
            select count(*)::int as count
            from matches
            where
              coalesce((evidence->>'overlap')::int, 0) < 2
              or coalesce((evidence->>'recomputedTitleSimilarity')::numeric, 1) < 0.80
              or coalesce(
                (evidence->>'marketplaceScore')::numeric,
                (evidence->>'marketplacePriceScore')::numeric,
                1
              ) < 0.50
              or (
                lower(coalesce(match_type, '')) = 'keyword_fuzzy'
                and confidence::numeric < 0.80
              )
          `)
        )[0]?.count
      )
    : null;

  const weakMatchReasons = await runQuery(`
    with weak_flags as (
      select 'low_token_overlap' as reason, count(*)::int as count
      from matches
      where coalesce((evidence->>'overlap')::int, 0) < 2
      union all
      select 'low_fuzzy_similarity' as reason, count(*)::int as count
      from matches
      where coalesce((evidence->>'recomputedTitleSimilarity')::numeric, 1) < 0.80
      union all
      select 'weak_marketplace_score' as reason, count(*)::int as count
      from matches
      where coalesce(
        (evidence->>'marketplaceScore')::numeric,
        (evidence->>'marketplacePriceScore')::numeric,
        1
      ) < 0.50
      union all
      select 'borderline_keyword_fuzzy' as reason, count(*)::int as count
      from matches
      where lower(coalesce(match_type, '')) = 'keyword_fuzzy'
        and coalesce(confidence::numeric, 0) >= 0.75
        and coalesce(confidence::numeric, 0) < 0.80
    )
    select reason, count
    from weak_flags
    where count > 0
    order by count desc, reason asc
  `);

  const invalidKeyCount = toNum(
    (
      await runQuery(`
        select count(*)::int as count
        from matches
        where coalesce(nullif(trim(supplier_key), ''), '') = ''
      `)
    )[0]?.count
  );

  const nonCanonicalKeyCount = toNum(
    (
      await runQuery(`
        select count(*)::int as count
        from matches
        where supplier_key <> lower(coalesce(supplier_key, ''))
      `)
    )[0]?.count
  );

  const inconsistentGroups = await runQuery(`
    select
      lower(coalesce(m.supplier_key, '')) as normalized_key,
      count(distinct m.supplier_key)::int as match_key_variants,
      count(distinct pr.supplier_key)::int as source_key_variants,
      array_agg(distinct m.supplier_key order by m.supplier_key) as match_keys,
      array_agg(distinct pr.supplier_key order by pr.supplier_key) filter (where pr.supplier_key is not null) as source_keys
    from matches m
    left join products_raw pr
      on pr.supplier_product_id = m.supplier_product_id
    group by 1
    having
      count(distinct m.supplier_key) > 1
      or count(distinct pr.supplier_key) > 1
      or bool_or(m.supplier_key <> lower(coalesce(m.supplier_key, '')))
    order by match_key_variants desc, source_key_variants desc, normalized_key asc
    limit 15
  `);

  return {
    totalMatches,
    activeMatches,
    inactiveMatches,
    confidenceDistribution,
    lowConfidenceCount,
    lowConfidenceAcceptedMatches,
    borderlineAcceptedMatches,
    duplicatePairCount,
    weakMatchCount,
    weakMatchReasons,
    duplicatePatterns,
    supplierKeyConsistency: {
      invalidKeyCount,
      nonCanonicalKeyCount,
      inconsistentGroups,
    },
  };
}
