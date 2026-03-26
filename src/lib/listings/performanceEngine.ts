import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  getEbayPublishEnvValidation,
  getEbaySellAccessToken,
  sanitizeEbayPayload,
  validateEbayImageHosting,
} from "@/lib/marketplaces/ebayPublish";
import { optimizeListingTitle } from "@/lib/listings/optimizeListingTitle";

type ActiveListingRow = {
  id: string;
  candidateId: string;
  title: string | null;
  payload: unknown;
  response: unknown;
  publishedExternalId: string | null;
};

type ListingTrafficMetrics = {
  listingId: string;
  impressionsTotal: number | null;
  viewsTotal: number | null;
  clickThroughRate: number | null;
  transactions: number | null;
};

type ListingRecommendation = {
  listingId: string;
  trendingBidPercentage: number | null;
  promoteWithAd: string | null;
};

type ExistingAd = {
  campaignId: string;
  adId: string;
  bidPercentage: number | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toNum(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => stringOrNull(entry)).filter((entry): entry is string => Boolean(entry));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function marketingScope(): string {
  return "https://api.ebay.com/oauth/api_scope/sell.marketing https://api.ebay.com/oauth/api_scope/sell.marketing.readonly";
}

function analyticsScope(): string {
  return "https://api.ebay.com/oauth/api_scope/sell.analytics.readonly";
}

async function getScopedToken(scope: string): Promise<string> {
  const validation = getEbayPublishEnvValidation();
  if (!validation.config) {
    throw new Error(`eBay config invalid: ${validation.errors.join(" | ")}`);
  }

  const config = validation.config;
  const auth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: config.refreshToken,
      scope,
    }),
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`eBay scoped token failed: ${res.status} ${text}`);
  }

  const parsed = JSON.parse(text) as { access_token?: string };
  if (!parsed.access_token) {
    throw new Error("eBay scoped token response missing access_token");
  }

  return parsed.access_token;
}

async function fetchTrafficMetrics(listingIds: string[]): Promise<Map<string, ListingTrafficMetrics>> {
  const metrics = new Map<string, ListingTrafficMetrics>();
  if (!listingIds.length) return metrics;

  const token = await getScopedToken(analyticsScope());
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";
  const windowDays = Math.max(1, Number(process.env.LISTING_PERF_WINDOW_DAYS ?? 14));
  const end = new Date();
  const start = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const url = new URL("https://api.ebay.com/sell/analytics/v1/traffic_report");

  url.searchParams.set("dimension", "LISTING");
  url.searchParams.set(
    "metric",
    "LISTING_VIEWS_TOTAL,TOTAL_IMPRESSION_TOTAL,CLICK_THROUGH_RATE,TRANSACTION"
  );
  url.searchParams.set(
    "filter",
    `marketplace_ids:{${marketplaceId}},listing_ids:{${listingIds.join("|")}},date_range:[${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}]`
  );

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Accept-Language": "en-US",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay traffic report failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    header?: { metrics?: Array<{ key?: string }> };
    records?: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: number | string }> }>;
  };

  const metricKeys = Array.isArray(body.header?.metrics) ? body.header?.metrics.map((metric) => String(metric.key ?? "")) : [];
  for (const record of body.records ?? []) {
    const listingId = String(record.dimensionValues?.[0]?.value ?? "").trim();
    if (!listingId) continue;
    const values = Array.isArray(record.metricValues) ? record.metricValues : [];
    const lookup = new Map<string, unknown>();
    metricKeys.forEach((key, index) => lookup.set(key, values[index]?.value));
    metrics.set(listingId, {
      listingId,
      impressionsTotal: toNum(lookup.get("TOTAL_IMPRESSION_TOTAL")),
      viewsTotal: toNum(lookup.get("LISTING_VIEWS_TOTAL")),
      clickThroughRate: toNum(lookup.get("CLICK_THROUGH_RATE")),
      transactions: toNum(lookup.get("TRANSACTION")),
    });
  }

  return metrics;
}

async function fetchListingRecommendations(listingIds: string[]): Promise<Map<string, ListingRecommendation>> {
  const recommendations = new Map<string, ListingRecommendation>();
  if (!listingIds.length) return recommendations;

  const token = await getEbaySellAccessToken();
  const res = await fetch("https://api.ebay.com/sell/recommendation/v1/find?filter=recommendationTypes:{AD}", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
    },
    body: JSON.stringify({ listingIds }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`eBay recommendations failed: ${res.status} ${await res.text()}`);
  }

  const body = (await res.json()) as {
    listingRecommendations?: Array<{
      listingId?: string;
      marketing?: { ad?: { bidPercentages?: Array<{ value?: string | number }>; promoteWithAd?: string } };
    }>;
  };

  for (const entry of body.listingRecommendations ?? []) {
    const listingId = String(entry.listingId ?? "").trim();
    if (!listingId) continue;
    recommendations.set(listingId, {
      listingId,
      trendingBidPercentage: toNum(entry.marketing?.ad?.bidPercentages?.[0]?.value),
      promoteWithAd: stringOrNull(entry.marketing?.ad?.promoteWithAd),
    });
  }

  return recommendations;
}

async function fetchExistingAd(inventoryItemKey: string): Promise<ExistingAd | null> {
  const token = await getScopedToken(marketingScope());
  const campaignRes = await fetch(
    `https://api.ebay.com/sell/marketing/v1/ad_campaign/find_campaign_by_ad_reference?inventory_reference_id=${encodeURIComponent(
      inventoryItemKey
    )}&inventory_reference_type=INVENTORY_ITEM`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!campaignRes.ok) return null;
  const campaignBody = (await campaignRes.json()) as { campaigns?: Array<{ campaignId?: string }> };
  const campaignId = stringOrNull(campaignBody.campaigns?.[0]?.campaignId);
  if (!campaignId) return null;

  const adsRes = await fetch(
    `https://api.ebay.com/sell/marketing/v1/ad_campaign/${encodeURIComponent(
      campaignId
    )}/get_ads_by_inventory_reference?inventory_reference_id=${encodeURIComponent(
      inventoryItemKey
    )}&inventory_reference_type=INVENTORY_ITEM`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  if (!adsRes.ok) return null;
  const adsBody = (await adsRes.json()) as {
    ads?: Array<{ adId?: string; bidPercentage?: string | number }>;
  };
  const ad = adsBody.ads?.[0];
  if (!ad?.adId) return null;

  return {
    campaignId,
    adId: String(ad.adId),
    bidPercentage: toNum(ad.bidPercentage),
  };
}

async function updateAdBid(input: { campaignId: string; adId: string; bidPercentage: number }) {
  const token = await getScopedToken(marketingScope());
  const res = await fetch(
    `https://api.ebay.com/sell/marketing/v1/ad_campaign/${encodeURIComponent(
      input.campaignId
    )}/ad/${encodeURIComponent(input.adId)}/update_bid`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bidPercentage: input.bidPercentage.toFixed(1) }),
      cache: "no-store",
    }
  );

  if (!res.ok && res.status !== 204) {
    throw new Error(`eBay updateBid failed: ${res.status} ${await res.text()}`);
  }
}

function reorderImages(payload: Record<string, unknown>): string[] {
  const media = asObject(payload.media);
  const mediaImages = Array.isArray(media?.images) ? media.images : [];
  const ranked = mediaImages
    .map((entry) => {
      const image = asObject(entry);
      return {
        url: stringOrNull(image?.url),
        kind: stringOrNull(image?.kind),
        rank: toNum(image?.rank) ?? 999,
      };
    })
    .filter((entry): entry is { url: string; kind: string | null; rank: number } => Boolean(entry.url));

  const kindRank = new Map<string, number>([
    ["hero", 0],
    ["angle", 1],
    ["lifestyle", 2],
    ["detail", 3],
    ["other", 4],
  ]);

  if (!ranked.length) return stringArray(payload.images);

  return ranked
    .sort((left, right) => {
      const leftKind = kindRank.get(left.kind ?? "other") ?? 9;
      const rightKind = kindRank.get(right.kind ?? "other") ?? 9;
      if (leftKind !== rightKind) return leftKind - rightKind;
      return left.rank - right.rank;
    })
    .map((entry) => entry.url)
    .slice(0, 24);
}

function deriveAspects(payload: Record<string, unknown>, title: string): Record<string, string[]> {
  const source = asObject(payload.source) ?? {};
  const composite = `${title} ${stringOrNull(source.supplierTitle) ?? ""}`.toLowerCase();
  const aspects: Record<string, string[]> = {
    Brand: [stringOrNull(payload.brand) ?? "Unbranded"],
    MPN: [stringOrNull(payload.mpn) ?? "Does Not Apply"],
    Type: [title.split(/\s+/).slice(0, 3).join(" ") || "Does Not Apply"],
  };

  if (composite.includes("lamp") || composite.includes("light")) aspects.Room = ["Bedroom", "Living Room", "Office"];
  if (composite.includes("decor") || composite.includes("gift")) aspects.Occasion = ["Gift"];
  if (composite.includes("fan")) aspects.PowerSource = ["USB"];
  if (composite.includes("mount")) aspects.Mounting = ["Dashboard", "Vent"];
  if (composite.includes("organizer")) aspects.Features = ["Compact", "Space Saving"];

  return aspects;
}

function firstSaleCandidateScore(input: {
  title: string;
  impressions: number | null;
  views: number | null;
  sellerFeedbackScore: number | null;
}): number {
  const text = input.title.toLowerCase();
  let score = 50;
  if (input.sellerFeedbackScore === 0) score += 10;
  if (text.includes("electronics") || text.includes("charger") || text.includes("bluetooth")) score -= 25;
  if (text.includes("decor") || text.includes("gift") || text.includes("organizer") || text.includes("lamp")) score += 20;
  if ((input.impressions ?? 0) > 0 && (input.views ?? 0) === 0) score -= 10;
  return Math.max(0, Math.min(100, score));
}

function deriveCommercialState(input: {
  impressions: number | null;
  views: number | null;
  ctr: number | null;
  attempts: number;
  firstSaleScore: number;
}): "TECHNICALLY_LIVE" | "FRESH_ACTIONABLE" | "COMMERCIAL_WEAK" | "DEAD_LISTING" | "FIRST_SALE_CANDIDATE" {
  if ((input.views ?? 0) === 0 && (input.impressions ?? 0) > 0) return "DEAD_LISTING";
  if ((input.firstSaleScore ?? 0) >= 70) return "FIRST_SALE_CANDIDATE";
  if ((input.impressions ?? 0) === 0 && input.attempts > 0) return "COMMERCIAL_WEAK";
  if ((input.ctr ?? 0) < 0.01 || (input.views ?? 0) < 3) return "COMMERCIAL_WEAK";
  if ((input.views ?? 0) > 0 || (input.impressions ?? 0) > 0) return "FRESH_ACTIONABLE";
  return "TECHNICALLY_LIVE";
}

async function reviseInventoryItem(input: {
  inventoryItemKey: string;
  title: string;
  images: string[];
  aspects: Record<string, string[]>;
}) {
  const token = await getEbaySellAccessToken();
  const validation = validateEbayImageHosting({
    images: input.images,
    media: {
      images: input.images.map((url, index) => ({ url, kind: index === 0 ? "hero" : "other", rank: index })),
    },
  });
  if (!validation.ok) {
    throw new Error(`${validation.code}: ${validation.reason}`);
  }

  const res = await fetch(
    `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(input.inventoryItemKey)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sku: input.inventoryItemKey,
        product: {
          title: input.title,
          imageUrls: validation.selectedUrls,
          aspects: input.aspects,
        },
      }),
      cache: "no-store",
    }
  );

  if (!res.ok) {
    throw new Error(`eBay inventory revise failed: ${res.status} ${await res.text()}`);
  }
}

export async function runListingPerformanceEngine(input?: {
  limit?: number;
  actorId?: string;
}) {
  const limit = Math.max(1, Number(input?.limit ?? 25));
  const actorId = input?.actorId ?? "listing.performance";
  const maxAttempts = Math.max(1, Number(process.env.LISTING_PERF_MAX_ATTEMPTS ?? 3));
  const applyLiveEdits = String(process.env.LISTING_PERF_APPLY_LIVE_EDITS ?? "true") === "true";
  const lowTrafficThreshold = Math.max(1, Number(process.env.LISTING_LOW_TRAFFIC_VIEWS_THRESHOLD ?? 3));
  const adRateCap = Math.max(2, Number(process.env.LISTING_PROMOTED_MAX_BID_PCT ?? 12));
  const adRateDelta = Math.max(0, Number(process.env.LISTING_PROMOTED_MAX_DELTA_PCT ?? 2));

  const listingsResult = await db.execute<ActiveListingRow>(sql`
    select
      l.id::text as "id",
      l.candidate_id::text as "candidateId",
      l.title as "title",
      l.payload as "payload",
      l.response as "response",
      l.published_external_id as "publishedExternalId"
    from listings l
    where lower(coalesce(l.marketplace_key, '')) = 'ebay'
      and upper(coalesce(l.status, '')) = 'ACTIVE'
    order by l.updated_at asc nulls first, l.publish_finished_ts asc nulls first
    limit ${limit}
  `);

  const rows = listingsResult.rows ?? [];
  const listingIds = rows.map((row) => String(row.publishedExternalId ?? "")).filter(Boolean);
  const [trafficByListingId, recommendationsByListingId, sellerMetricsResult] = await Promise.all([
    fetchTrafficMetrics(listingIds).catch(() => new Map<string, ListingTrafficMetrics>()),
    fetchListingRecommendations(listingIds).catch(() => new Map<string, ListingRecommendation>()),
    db.execute<{ feedbackScore: number | null }>(sql`
      select feedback_score::int as "feedbackScore"
      from seller_account_metrics
      where lower(coalesce(marketplace_key, '')) = 'ebay'
      limit 1
    `).catch(() => ({ rows: [] as Array<{ feedbackScore: number | null }> })),
  ]);

  const sellerFeedbackScore = toNum(sellerMetricsResult.rows?.[0]?.feedbackScore);

  let checked = 0;
  let zeroViewListings = 0;
  let lowTrafficListings = 0;
  let titlesOptimized = 0;
  let specificsImproved = 0;
  let promotedAdjusted = 0;
  let deadRecoveryActions = 0;

  for (const row of rows) {
    checked++;
    const payload = sanitizeEbayPayload(row.payload);
    const response = asObject(row.response) ?? {};
    const listingPerf = asObject(response.listingPerformance) ?? {};
    const optimization = asObject(listingPerf.optimization) ?? {};
    const attempts = Math.max(0, Math.floor(toNum(optimization.attempts) ?? 0));
    const inventoryItemKey =
      stringOrNull(response.inventoryItemKey) ??
      `qab-${String(row.id).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40)}`;
    const currentTitle = stringOrNull(payload.title) ?? stringOrNull(row.title) ?? "QuickAIBuy Listing";
    const traffic = row.publishedExternalId ? trafficByListingId.get(row.publishedExternalId) : undefined;
    const recommendation = row.publishedExternalId ? recommendationsByListingId.get(row.publishedExternalId) : undefined;
    const impressions = traffic?.impressionsTotal ?? null;
    const views = traffic?.viewsTotal ?? null;
    const ctr = traffic?.clickThroughRate ?? null;
    const isZeroView = (views ?? 0) === 0 && (impressions ?? 0) > 0;
    const isLowTraffic = (views ?? 0) < lowTrafficThreshold;

    const optimizedTitle = optimizeListingTitle({
      marketplaceTitle: stringOrNull(asObject(payload.matchedMarketplace)?.marketplaceTitle),
      supplierTitle: stringOrNull(asObject(payload.source)?.supplierTitle),
      supplierKey: stringOrNull(asObject(payload.source)?.supplierKey) ?? "supplier",
      supplierProductId: stringOrNull(asObject(payload.source)?.supplierProductId) ?? row.id,
    });
    const images = reorderImages(payload);
    const aspects = deriveAspects(payload, optimizedTitle || currentTitle);
    const specificsCount = Object.keys(aspects).length;
    const firstSaleScore = firstSaleCandidateScore({
      title: optimizedTitle || currentTitle,
      impressions,
      views,
      sellerFeedbackScore,
    });
    const state = deriveCommercialState({
      impressions,
      views,
      ctr,
      attempts,
      firstSaleScore,
    });
    const shouldOptimize =
      attempts < maxAttempts &&
      (state === "DEAD_LISTING" || state === "COMMERCIAL_WEAK" || state === "FIRST_SALE_CANDIDATE");
    const titleChanged = Boolean(optimizedTitle && optimizedTitle !== currentTitle && optimizedTitle.length >= 30);

    if (isZeroView) zeroViewListings++;
    if (isLowTraffic) lowTrafficListings++;

    let adAdjustment: Record<string, unknown> | null = null;
    const currentBid = toNum(asObject(listingPerf.promoted)?.currentBidPercentage);
    const suggestedBid = recommendation?.trendingBidPercentage ?? null;
    const belowSuggested = suggestedBid != null && currentBid != null && currentBid + 0.2 < suggestedBid;
    const targetBid =
      belowSuggested && currentBid != null
        ? Math.min(adRateCap, round1(Math.max(currentBid, Math.min(suggestedBid, currentBid + adRateDelta))))
        : null;

    if (shouldOptimize && applyLiveEdits && targetBid != null) {
      const ad = await fetchExistingAd(inventoryItemKey).catch(() => null);
      if (ad?.bidPercentage != null && targetBid > ad.bidPercentage) {
        await updateAdBid({
          campaignId: ad.campaignId,
          adId: ad.adId,
          bidPercentage: targetBid,
        });
        adAdjustment = {
          campaignId: ad.campaignId,
          adId: ad.adId,
          previousBidPercentage: ad.bidPercentage,
          updatedBidPercentage: targetBid,
        };
        promotedAdjusted++;
      }
    }

    if (shouldOptimize && applyLiveEdits) {
      await reviseInventoryItem({
        inventoryItemKey,
        title: titleChanged ? optimizedTitle : currentTitle,
        images,
        aspects,
      }).catch(() => undefined);
    }

    if (shouldOptimize && titleChanged) titlesOptimized++;
    if (shouldOptimize && specificsCount >= 3) specificsImproved++;
    if (shouldOptimize && state === "DEAD_LISTING") deadRecoveryActions++;

    const nextPayload: Record<string, unknown> = {
      ...payload,
      title: titleChanged ? optimizedTitle : currentTitle,
      images,
      itemSpecifics: aspects,
    };
    const nextResponse: Record<string, unknown> = {
      ...response,
      listingPerformance: {
        windowDays: Math.max(1, Number(process.env.LISTING_PERF_WINDOW_DAYS ?? 14)),
        metrics: {
          impressionsTotal: impressions,
          viewsTotal: views,
          clickThroughRate: ctr,
          transactions: traffic?.transactions ?? null,
          watchers: null,
        },
        promoted: {
          currentBidPercentage: currentBid,
          suggestedBidPercentage: suggestedBid,
          promoteWithAd: recommendation?.promoteWithAd ?? null,
          belowSuggested,
          adjustment: adAdjustment,
        },
        optimization: {
          attempts: shouldOptimize ? attempts + 1 : attempts,
          maxAttempts,
          titleChanged: shouldOptimize && titleChanged,
          itemSpecificsImproved: shouldOptimize && specificsCount >= 3,
          imageOrderImproved: shouldOptimize && images.length > 0,
          appliedLiveEdits: shouldOptimize && applyLiveEdits,
          lastActionTs: new Date().toISOString(),
          stopReason: attempts >= maxAttempts ? "max-attempts-reached" : null,
        },
        readiness: {
          commercialState: state,
          firstSaleScore,
          firstSaleCandidate: firstSaleScore >= 70,
          weakSignals: {
            zeroViews: isZeroView,
            lowTraffic: isLowTraffic,
            missingItemSpecifics: specificsCount < 3,
            weakTitle: !titleChanged && currentTitle.length < 45,
          },
        },
        payloadAudit: {
          specificsCount,
          imageCount: images.length,
        },
      },
    };

    await db.execute(sql`
      update listings
      set
        title = ${String(nextPayload.title ?? currentTitle)},
        payload = ${JSON.stringify(nextPayload)}::jsonb,
        response = ${JSON.stringify(nextResponse)}::jsonb,
        updated_at = now()
      where id = ${row.id}
    `);

    await writeAuditLog({
      actorType: "WORKER",
      actorId,
      entityType: "LISTING",
      entityId: row.id,
      eventType: "LISTING_PERFORMANCE_EVALUATED",
      details: {
        listingId: row.id,
        candidateId: row.candidateId,
        commercialState: state,
        firstSaleScore,
        metrics: traffic ?? null,
        recommendation: recommendation ?? null,
        titleChanged,
        specificsCount,
        adAdjustment,
      },
    });
  }

  return {
    ok: true,
    checked,
    zeroViewListings,
    lowTrafficListings,
    titlesOptimized,
    specificsImproved,
    promotedAdjusted,
    deadRecoveryActions,
  };
}
