import pg from "pg";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

type JsonRecord = Record<string, unknown>;

type CandidateRow = {
  candidate_id: string;
  supplier_key: string;
  supplier_product_id: string;
  listing_block_reason: string | null;
  decision_status: string | null;
  calc_ts: string | null;
  shipping_estimates: unknown;
  raw_payload: unknown;
  snapshot_ts: string | null;
};

type TraceBucket =
  | "shipping_option_origin"
  | "warehouse_origin"
  | "logistics_origin"
  | "variant_origin"
  | "gallery_media"
  | "variant_media"
  | "description_media"
  | "video_media";

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : null;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out: { limit: number; candidateIds: string[] } = { limit: 5, candidateIds: [] };
  for (const arg of args) {
    if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice("--limit=".length).trim());
      if (Number.isFinite(parsed) && parsed > 0) out.limit = Math.min(20, Math.floor(parsed));
      continue;
    }
    if (arg.startsWith("--candidate-id=")) {
      const id = arg.slice("--candidate-id=".length).trim();
      if (id) out.candidateIds.push(id);
      continue;
    }
  }
  return out;
}

function classifyBucket(path: string): TraceBucket | null {
  const lower = path.toLowerCase();
  if (/(gallery|imagegallery|images\[|mainimage|thumbnail|photolist)/.test(lower)) return "gallery_media";
  if (/(variantimages|skuimage|propertyvalue|skuattr|colorimage)/.test(lower)) return "variant_media";
  if (/(descriptionimages|descimg|descimage|richtext|detailimage|productdetail)/.test(lower)) return "description_media";
  if (/(videourls|video|playurl|videopath|poster)/.test(lower)) return "video_media";
  if (/(warehouse|fulfillment|inventory)/.test(lower)) return "warehouse_origin";
  if (/(logistics|route|deliveryoption|shippingoption|transit|freight)/.test(lower)) return "logistics_origin";
  if (/(variant|sku|propertyvalue)/.test(lower)) return "variant_origin";
  if (/(shipfrom|origincountry|fromcountry|dispatchfrom|deliveryfrom|sendercountry|sendcountry|storecountry|sellercountry)/.test(lower)) {
    return "shipping_option_origin";
  }
  return null;
}

function collectTrace(
  node: unknown,
  path: string,
  sink: Record<TraceBucket, Array<{ path: string; value: unknown }>>,
  depth = 0
): void {
  if (node == null || depth > 6) return;
  if (Array.isArray(node)) {
    node.forEach((entry, index) => collectTrace(entry, `${path}[${index}]`, sink, depth + 1));
    return;
  }
  const record = asRecord(node);
  if (!record) return;

  for (const [key, value] of Object.entries(record)) {
    const nextPath = path ? `${path}.${key}` : key;
    const bucket = classifyBucket(nextPath);
    if (bucket) {
      const sample =
        Array.isArray(value)
          ? { count: value.length, sample: value.slice(0, 3) }
          : asRecord(value) ?? asString(value) ?? value;
      sink[bucket].push({ path: nextPath, value: sample });
    }
    if (Array.isArray(value) || asRecord(value)) collectTrace(value, nextPath, sink, depth + 1);
  }
}

function summarizeMedia(payload: JsonRecord | null) {
  const media = asRecord(payload?.media);
  const arrays = [
    Array.isArray(payload?.images) ? payload.images.length : 0,
    Array.isArray(payload?.imageGallery) ? payload.imageGallery.length : 0,
    Array.isArray(payload?.galleryImages) ? payload.galleryImages.length : 0,
    Array.isArray(payload?.variantImages) ? payload.variantImages.length : 0,
    Array.isArray(payload?.descriptionImages) ? payload.descriptionImages.length : 0,
    Array.isArray(payload?.videoUrls) ? payload.videoUrls.length : 0,
    Array.isArray(media?.images) ? (media.images as unknown[]).length : 0,
    Array.isArray(media?.galleryImages) ? (media.galleryImages as unknown[]).length : 0,
    Array.isArray(media?.variantImages) ? (media.variantImages as unknown[]).length : 0,
    Array.isArray(media?.descriptionImages) ? (media.descriptionImages as unknown[]).length : 0,
    Array.isArray(media?.videoUrls) ? (media.videoUrls as unknown[]).length : 0,
  ];
  return {
    imageCount: Math.max(...arrays.slice(0, 5), 0),
    videoCount: Math.max(...arrays.slice(5), 0),
    mediaPresent: arrays.some((count) => count > 0),
  };
}

async function main() {
  const options = parseArgs();
  let databaseUrl: string;
  try {
    databaseUrl = getRequiredDatabaseUrl();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: "DB_RUNTIME_UNAVAILABLE",
          message:
            "AliExpress blocked-candidate tracing requires a DB-enabled runtime with DATABASE_URL or DATABASE_URL_DIRECT configured.",
          detail,
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const client = new Client({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const params: unknown[] = [];
    let candidateFilter = "";
    if (options.candidateIds.length) {
      params.push(options.candidateIds);
      candidateFilter = `AND pc.id = ANY($${params.length}::uuid[])`;
    }
    params.push(options.limit);

    const result = await client.query<CandidateRow>(
      `
      WITH latest_products AS (
        SELECT DISTINCT ON (lower(pr.supplier_key), pr.supplier_product_id)
          lower(pr.supplier_key) AS supplier_key,
          pr.supplier_product_id,
          pr.shipping_estimates,
          pr.raw_payload,
          pr.snapshot_ts
        FROM products_raw pr
        ORDER BY lower(pr.supplier_key), pr.supplier_product_id, pr.snapshot_ts DESC NULLS LAST, pr.id DESC
      )
      SELECT
        pc.id::text AS candidate_id,
        lower(pc.supplier_key) AS supplier_key,
        pc.supplier_product_id,
        pc.listing_block_reason,
        pc.decision_status,
        pc.calc_ts::text,
        lp.shipping_estimates,
        lp.raw_payload,
        lp.snapshot_ts::text
      FROM profitable_candidates pc
      JOIN latest_products lp
        ON lp.supplier_key = lower(pc.supplier_key)
       AND lp.supplier_product_id = pc.supplier_product_id
      WHERE lower(pc.supplier_key) = 'aliexpress'
        AND (
          coalesce(pc.listing_block_reason, '') ILIKE '%SHIPPING%'
          OR coalesce(pc.listing_block_reason, '') ILIKE '%MEDIA%'
          OR upper(coalesce(pc.decision_status, '')) = 'MANUAL_REVIEW'
        )
        ${candidateFilter}
      ORDER BY pc.calc_ts DESC NULLS LAST
      LIMIT $${params.length}
      `,
      params
    );

    const traced = result.rows.map((row) => {
      const payload = asRecord(row.raw_payload);
      const buckets: Record<TraceBucket, Array<{ path: string; value: unknown }>> = {
        shipping_option_origin: [],
        warehouse_origin: [],
        logistics_origin: [],
        variant_origin: [],
        gallery_media: [],
        variant_media: [],
        description_media: [],
        video_media: [],
      };
      collectTrace(payload, "raw_payload", buckets);

      return {
        candidateId: row.candidate_id,
        supplierKey: row.supplier_key,
        supplierProductId: row.supplier_product_id,
        decisionStatus: row.decision_status,
        listingBlockReason: row.listing_block_reason,
        snapshotTs: row.snapshot_ts,
        shippingEstimateCount: Array.isArray(row.shipping_estimates) ? row.shipping_estimates.length : 0,
        mediaSummary: summarizeMedia(payload),
        sourceTrace: {
          shipFromOrOptionOrigin: buckets.shipping_option_origin,
          warehouseOrigin: buckets.warehouse_origin,
          logisticsOrigin: buckets.logistics_origin,
          variantOrigin: buckets.variant_origin,
          galleryMedia: buckets.gallery_media,
          variantMedia: buckets.variant_media,
          descriptionMedia: buckets.description_media,
          videoMedia: buckets.video_media,
        },
      };
    });

    console.log(
      JSON.stringify(
        {
          ok: true,
          generatedAt: new Date().toISOString(),
          candidateCount: traced.length,
          candidates: traced,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("trace_aliexpress_origin_media_evidence failed", error);
  process.exit(1);
});
