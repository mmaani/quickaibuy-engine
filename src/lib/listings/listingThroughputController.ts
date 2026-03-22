import { db } from "@/lib/db";
import { getEbayPublishEnvValidation, getEbaySellAccessToken } from "@/lib/marketplaces/ebayPublish";
import { sql } from "drizzle-orm";

export type ListingThroughputPolicy = {
  sellerFeedback: number;
  maxActiveListings: number;
  maxDailyPublish: number;
  feedbackSource: "ebay-api" | "env" | "marketplace-match" | "fail-closed-default";
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

let cachedSellerFeedback: { value: number; expiresAt: number } | null = null;

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

async function fetchEbaySellerFeedbackScore(): Promise<number | null> {
  const now = Date.now();
  if (cachedSellerFeedback && cachedSellerFeedback.expiresAt > now) {
    return cachedSellerFeedback.value;
  }

  const validation = getEbayPublishEnvValidation();
  if (!validation.config) return null;

  const token = await getEbaySellAccessToken(validation.config);
  const response = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetFeedback",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1231",
      "X-EBAY-API-IAF-TOKEN": token,
    },
    body: `<?xml version="1.0" encoding="utf-8"?>
<GetFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
</GetFeedbackRequest>`,
    cache: "no-store",
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`eBay GetFeedback failed: ${response.status}`);
  }

  const match = body.match(/<FeedbackScore>(\d+)<\/FeedbackScore>/i);
  if (!match) return null;

  const value = toInt(match[1], 0);
  cachedSellerFeedback = {
    value,
    expiresAt: now + 10 * 60 * 1000,
  };
  return value;
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

  let sellerFeedback = 0;
  let feedbackSource: ListingThroughputPolicy["feedbackSource"] = "fail-closed-default";

  try {
    const ebayFeedback = await fetchEbaySellerFeedbackScore();
    if (ebayFeedback != null) {
      sellerFeedback = ebayFeedback;
      feedbackSource = "ebay-api";
    }
  } catch {
    // fall through to env/database fallback
  }

  if (feedbackSource === "fail-closed-default" && envFeedback != null) {
    sellerFeedback = envFeedback;
    feedbackSource = "env";
  }

  if (feedbackSource === "fail-closed-default") {
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
