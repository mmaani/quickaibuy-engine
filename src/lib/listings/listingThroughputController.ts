import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type ListingThroughputPolicy = {
  sellerFeedback: number;
  maxActiveListings: number;
  maxDailyPublish: number;
  feedbackSource: "env" | "marketplace-match" | "fail-closed-default";
};

export type ListingThroughputState = ListingThroughputPolicy & {
  marketplaceKey: "ebay";
  activeListings: number;
  publishedToday: number;
  activeAllowed: boolean;
  dailyAllowed: boolean;
  allowed: boolean;
  blockingReason: string | null;
};

type Input = {
  marketplaceKey?: "ebay";
  candidateId: string;
  marketplaceListingId: string;
};

function toInt(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : fallback;
}

function resolveConfiguredSellerFeedback(): number | null {
  const raw =
    process.env.EBAY_SELLER_FEEDBACK_SCORE ??
    process.env.SELLER_FEEDBACK_SCORE ??
    process.env.SELLER_FEEDBACK;
  if (raw == null || String(raw).trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;
}

function buildPolicy(
  sellerFeedback: number,
  feedbackSource: ListingThroughputPolicy["feedbackSource"]
): ListingThroughputPolicy {
  if (sellerFeedback >= 20) {
    return {
      sellerFeedback,
      maxActiveListings: 50,
      maxDailyPublish: 10,
      feedbackSource,
    };
  }

  if (sellerFeedback >= 5) {
    return {
      sellerFeedback,
      maxActiveListings: 20,
      maxDailyPublish: 5,
      feedbackSource,
    };
  }

  return {
    sellerFeedback,
    maxActiveListings: 5,
    maxDailyPublish: 2,
    feedbackSource,
  };
}

export async function getListingThroughputState(input: Input): Promise<ListingThroughputState> {
  const marketplaceKey = (input.marketplaceKey ?? "ebay") as "ebay";
  const envFeedback = resolveConfiguredSellerFeedback();

  let sellerFeedback = envFeedback ?? 0;
  let feedbackSource: ListingThroughputPolicy["feedbackSource"] =
    envFeedback != null ? "env" : "fail-closed-default";

  if (envFeedback == null) {
    const feedbackResult = await db.execute(sql`
      SELECT mp.raw_payload->'seller'->>'feedbackScore' AS seller_feedback
      FROM marketplace_prices mp
      WHERE mp.marketplace_key = ${marketplaceKey}
        AND mp.marketplace_listing_id = ${input.marketplaceListingId}
      ORDER BY mp.snapshot_ts DESC NULLS LAST
      LIMIT 1
    `);

    const marketplaceFeedback = toInt(
      (feedbackResult.rows?.[0] as Record<string, unknown> | undefined)?.seller_feedback,
      0
    );

    sellerFeedback = marketplaceFeedback;
    feedbackSource = marketplaceFeedback > 0 ? "marketplace-match" : "fail-closed-default";
  }

  const policy = buildPolicy(sellerFeedback, feedbackSource);

  const countsResult = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE marketplace_key = ${marketplaceKey} AND status = 'ACTIVE')::int AS active_listings,
      COUNT(*) FILTER (
        WHERE marketplace_key = ${marketplaceKey}
          AND status = 'ACTIVE'
          AND listing_date = CURRENT_DATE
          AND published_external_id IS NOT NULL
      )::int AS published_today
    FROM listings
  `);

  const row = (countsResult.rows?.[0] ?? {}) as Record<string, unknown>;
  const activeListings = toInt(row.active_listings, 0);
  const publishedToday = toInt(row.published_today, 0);
  const activeAllowed = activeListings < policy.maxActiveListings;
  const dailyAllowed = publishedToday < policy.maxDailyPublish;

  let blockingReason: string | null = null;
  if (!activeAllowed) {
    blockingReason = `max_active_listings reached (${activeListings}/${policy.maxActiveListings})`;
  } else if (!dailyAllowed) {
    blockingReason = `max_daily_publish reached (${publishedToday}/${policy.maxDailyPublish})`;
  }

  return {
    marketplaceKey,
    ...policy,
    activeListings,
    publishedToday,
    activeAllowed,
    dailyAllowed,
    allowed: activeAllowed && dailyAllowed,
    blockingReason,
  };
}
