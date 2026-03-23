import { sql } from "drizzle-orm";
import { db } from "../db/index";

type TrendCandidateRow = {
  id: string;
  candidate_value: string;
  region: string | null;
  meta: unknown;
};

type ProductSeed = {
  marketplace: string;
  productTitle: string;
  marketplaceListingId: string;
  productUrl: string;
  price: string;
};

export type ProductDiscoverOptions = {
  marketplace?: string;
  keywordOverride?: string;
};

export type ProductDiscoverResult = {
  candidateId: string;
  keyword: string;
  insertedCount: number;
  markets: string[];
};

const MARKETPLACES = ["amazon", "ebay", "temu", "aliexpress", "alibaba"];

function isStubProductDiscoverEnabled(): boolean {
  return (
    process.env.ENABLE_STUB_PRODUCT_DISCOVER === "true" ||
    process.env.NODE_ENV === "development"
  );
}

function hashToInt(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function normalizeMarketplace(input?: string): string | null {
  if (!input) return null;
  const value = String(input).trim().toLowerCase();
  return MARKETPLACES.includes(value) ? value : null;
}

function buildSeeds(candidateId: string, keyword: string, marketplaces: string[]): ProductSeed[] {
  const compactKeyword = keyword.replace(/\s+/g, " ").trim();

  return marketplaces.map((marketplace, idx) => {
    const seed = hashToInt(`${candidateId}:${marketplace}:${compactKeyword}`);
    const dollars = 14 + (seed % 50) + idx;
    const cents = (seed % 100).toString().padStart(2, "0");
    const slug = compactKeyword.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
    const listingId = `${marketplace}-${candidateId.slice(0, 8)}-${seed.toString(36).slice(0, 6)}`;

    return {
      marketplace,
      productTitle: `${compactKeyword} ${marketplace.toUpperCase()} Listing`,
      marketplaceListingId: listingId,
      productUrl: `https://${marketplace}.example.com/item/${slug}/${listingId}`,
      price: `${dollars}.${cents}`,
    };
  });
}

async function getTrendCandidate(candidateId: string): Promise<TrendCandidateRow | null> {
  const result = await db.execute(sql<TrendCandidateRow>`
    SELECT id, candidate_value, region, meta
    FROM trend_candidates
    WHERE id = ${candidateId}
    LIMIT 1
  `);

  const rows = (result as unknown as { rows?: TrendCandidateRow[] }).rows ?? [];
  return rows[0] ?? null;
}

export async function discoverProductsForCandidate(
  candidateId: string,
  options: ProductDiscoverOptions = {}
): Promise<ProductDiscoverResult> {
  if (!isStubProductDiscoverEnabled()) {
    throw new Error(
      "Stub product discovery is disabled. Set ENABLE_STUB_PRODUCT_DISCOVER=true only for controlled development/testing."
    );
  }

  const row = await getTrendCandidate(candidateId);

  if (!row) {
    throw new Error(`trend_candidate not found: ${candidateId}`);
  }

  const keyword = String(options.keywordOverride ?? row.candidate_value ?? "").trim();
  if (!keyword) {
    throw new Error(`trend_candidate ${candidateId} has empty candidate_value`);
  }

  const oneMarketplace = normalizeMarketplace(options.marketplace);
  const markets = oneMarketplace ? [oneMarketplace] : MARKETPLACES;

  const seeds = buildSeeds(candidateId, keyword, markets);
  let insertedCount = 0;

  for (const seed of seeds) {
    const result = await db.execute(sql<{ id: string }>`
      INSERT INTO product_candidates (
        id,
        candidate_id,
        product_title,
        marketplace,
        marketplace_listing_id,
        price,
        currency,
        product_url,
        source,
        status,
        discovered_ts,
        meta
      )
      SELECT
        gen_random_uuid(),
        ${candidateId},
        ${seed.productTitle},
        ${seed.marketplace},
        ${seed.marketplaceListingId},
        ${seed.price}::numeric,
        'USD',
        ${seed.productUrl},
        'stub',
        'DISCOVERED',
        NOW(),
        ${JSON.stringify({
          source: "product-discover-stub",
          keyword,
          region: row.region,
          availabilitySignal: "UNKNOWN",
          availabilityConfidence: 0.3,
          trendMeta: row.meta ?? null,
        })}::jsonb
      WHERE NOT EXISTS (
        SELECT 1
        FROM product_candidates pc
        WHERE pc.candidate_id = ${candidateId}
          AND pc.marketplace = ${seed.marketplace}
          AND pc.marketplace_listing_id = ${seed.marketplaceListingId}
      )
      RETURNING id
    `);

    insertedCount += ((result as unknown as { rows?: Array<{ id: string }> }).rows ?? []).length;
  }

  return {
    candidateId,
    keyword,
    insertedCount,
    markets: seeds.map((s) => s.marketplace),
  };
}
