import pg from "pg";
import { randomUUID } from "node:crypto";
import { getRequiredDatabaseUrl, loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

type ListingRow = {
  id: string;
  candidate_id: string;
  status: string;
  title: string;
  price: string;
  quantity: number;
  payload: Record<string, unknown>;
  response: Record<string, unknown> | null;
  published_external_id: string | null;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function safeSku(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._-]/g, "-");
  const bounded = cleaned.slice(0, 50);
  return bounded || `qab-${Date.now()}`;
}

function buildDescription(payload: Record<string, unknown>, title: string): string {
  const description = stringOrNull(payload.description);
  if (description) return description.slice(0, 4000);
  return `${title}\n\nCondition: New`.slice(0, 4000);
}

function requireListingId(): string {
  return String(process.argv[2] ?? "59f326e5-99dd-485f-a054-43aa353c42b0").trim();
}

function classifyRuntimeCapability(input: {
  publishEnvOk: boolean;
  mockProviderActive: boolean;
  defaultProvider: string;
}): "fully_live_capable" | "partially_live_capable" | "still_mock_only" {
  if (input.mockProviderActive) return "still_mock_only";
  if (!input.publishEnvOk) return "partially_live_capable";
  return input.defaultProvider === "media_api" ? "fully_live_capable" : "partially_live_capable";
}

async function fetchListing(client: pg.Client, listingId: string): Promise<ListingRow> {
  const result = await client.query<ListingRow>(
    `
      SELECT
        l.id,
        l.candidate_id,
        l.status,
        l.title,
        l.price::text,
        l.quantity,
        l.payload,
        l.response,
        l.published_external_id
      FROM listings l
      WHERE l.id = $1
      LIMIT 1
    `,
    [listingId]
  );

  if (!result.rows.length) {
    throw new Error(`listing not found: ${listingId}`);
  }
  return result.rows[0];
}

async function insertTempPreviewRow(client: pg.Client, listing: ListingRow): Promise<string> {
  const tempIdempotencyKey = `media-api-live-validation:${listing.candidate_id}:${randomUUID()}`;
  const inserted = await client.query<{ id: string }>(
    `
      INSERT INTO listings (
        candidate_id,
        marketplace_key,
        status,
        title,
        price,
        quantity,
        payload,
        response,
        idempotency_key
      )
      VALUES ($1, 'ebay', 'PREVIEW', $2, $3::numeric, $4, $5::jsonb, $6::jsonb, $7)
      RETURNING id
    `,
    [
      listing.candidate_id,
      listing.title,
      listing.price,
      listing.quantity,
      JSON.stringify(listing.payload),
      JSON.stringify(listing.response ?? {}),
      tempIdempotencyKey,
    ]
  );
  return inserted.rows[0].id;
}

async function main() {
  const listingId = requireListingId();
  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  const {
    getEbayImageHostingConfig,
    normalizeImageFromUrl,
  } = await import("@/lib/marketplaces/ebayImageHosting");
  const { normalizeEbayListingImages } = await import("@/lib/listings/normalizeEbayImages");
  const { validateListingReadyImageState, markListingReadyToPublish } = await import(
    "@/lib/listings/markListingReadyToPublish"
  );
  const {
    getEbayPublishEnvValidation,
    getEbaySellAccessToken,
    validateEbayImageHosting,
    validateEbayPublishPreflight,
    sanitizeEbayPayload,
  } = await import("@/lib/marketplaces/ebayPublish");

  await client.connect();
  let tempListingId: string | null = null;

  try {
    const listing = await fetchListing(client, listingId);
    const payload = listing.payload;
    const response = listing.response ?? {};

    const runtimeReadiness = {
      environment: "production",
      listingId,
      listingStatus: listing.status,
      publishedExternalId: listing.published_external_id,
      publishEnv: (() => {
        const validation = getEbayPublishEnvValidation();
        return {
          ok: validation.ok,
          errors: validation.errors,
          redacted: validation.redacted,
          publicUrls: validation.publicUrls,
        };
      })(),
      imageHosting: getEbayImageHostingConfig(),
      mockProviderActive:
        String(process.env.EBAY_IMAGE_PROVIDER_DEFAULT ?? "").trim().toLowerCase() === "mock_eps" ||
        String(process.env.EBAY_IMAGE_HOSTING_PROVIDER ?? "").trim().toLowerCase() === "mock_eps",
    };
    const runtimeCapability = classifyRuntimeCapability({
      publishEnvOk: runtimeReadiness.publishEnv.ok,
      mockProviderActive: runtimeReadiness.mockProviderActive,
      defaultProvider: runtimeReadiness.imageHosting.defaultProvider,
    });

    const sourceUrls = Array.isArray(payload.images)
      ? payload.images.map((entry) => String(entry))
      : [];
    const firstSourceUrl = sourceUrls[0];
    if (!firstSourceUrl) {
      throw new Error("listing payload does not contain source image URLs");
    }

    const singleImageProof = await normalizeImageFromUrl(firstSourceUrl);

    const normalized = await normalizeEbayListingImages({
      payload,
      response,
    });

    tempListingId = await insertTempPreviewRow(client, listing);
    const readyBefore = await markListingReadyToPublish({
      listingId: tempListingId,
      actorId: "validate_live_media_api_cutover.ts",
      actorType: "SYSTEM",
    });

    await client.query(
      `
        UPDATE listings
        SET
          payload = $2::jsonb,
          response = $3::jsonb,
          updated_at = NOW()
        WHERE id = $1
      `,
      [tempListingId, JSON.stringify(normalized.payload), JSON.stringify(normalized.response ?? {})]
    );

    const readyAfter = await markListingReadyToPublish({
      listingId: tempListingId,
      actorId: "validate_live_media_api_cutover.ts",
      actorType: "SYSTEM",
    });

    const tempRow = await fetchListing(client, tempListingId);

    const sanitized = sanitizeEbayPayload(normalized.payload);
    const preflight = await validateEbayPublishPreflight(sanitized);
    if (!preflight.ok || !preflight.config) {
      throw new Error(`publish preflight failed: ${preflight.errors.join(" | ")}`);
    }
    const token = await getEbaySellAccessToken(preflight.config);
    const title = stringOrNull(sanitized.title) ?? listing.title;
    const description = buildDescription(sanitized, title);
    const sku = safeSku(`qab-${listing.id}`);
    const quantity = Math.max(1, Math.floor(Number(sanitized.quantity ?? listing.quantity ?? 1)));
    const imageUrls = Array.isArray(sanitized.images) ? sanitized.images.map((entry) => String(entry)) : [];

    const inventoryPutResponse = await fetch(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "en-US",
          "Content-Language": "en-US",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sku,
          availability: {
            shipToLocationAvailability: {
              quantity,
            },
          },
          condition: String(sanitized.condition ?? "NEW"),
          product: {
            title,
            description,
            imageUrls,
            aspects: {
              Brand: [stringOrNull(sanitized.brand) ?? "Unbranded"],
              MPN: [stringOrNull(sanitized.mpn) ?? "Does Not Apply"],
              Type: ["Does Not Apply"],
              CountryOfOrigin: [String(sanitized.shipFromCountry ?? "CN")],
            },
          },
        }),
        cache: "no-store",
      }
    );

    const inventoryPutBody = await inventoryPutResponse.text();
    const inventoryGetResponse = await fetch(
      `https://api.ebay.com/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Accept-Language": "en-US",
          "Content-Language": "en-US",
          "Content-Type": "application/json",
        },
        cache: "no-store",
      }
    );
    const inventoryGetBody = await inventoryGetResponse.text();
    let inventoryGetParsed: Record<string, unknown> | null = null;
    try {
      inventoryGetParsed = JSON.parse(inventoryGetBody) as Record<string, unknown>;
    } catch {
      inventoryGetParsed = null;
    }

    const controlledFailure = await normalizeEbayListingImages({
      payload: {
        marketplace: "ebay",
        images: ["http://invalid.example.com/not-https.jpg"],
        media: {
          images: [
            {
              url: "http://invalid.example.com/not-https.jpg",
              kind: "hero",
              rank: 1,
              source: "supplier",
              fingerprint: "bad",
              reasons: [],
            },
          ],
          audit: {
            imageSelectedCount: 1,
            selectedImageUrls: ["http://invalid.example.com/not-https.jpg"],
          },
        },
      },
      response: {
        imageOrder: [
          {
            rank: 1,
            url: "http://invalid.example.com/not-https.jpg",
            kind: "hero",
            source: "supplier",
            hostingMode: "external",
          },
        ],
      },
    });

    console.log(
      JSON.stringify(
        {
          runtimeReadiness,
          runtimeCapability,
          liveProofCandidate: {
            listingId: listing.id,
            candidateId: listing.candidate_id,
            listingStatus: listing.status,
            publishedExternalId: listing.published_external_id,
          },
          liveNormalizationEvidence: {
            sourceUrls: sourceUrls.slice(0, 5),
            providerAttempted: normalized.diagnostics.providerAttempted,
            providerUsed: normalized.diagnostics.providerUsed,
            mediaApiResultCode: normalized.diagnostics.mediaApiResultCode,
            tradingFallbackResultCode: normalized.diagnostics.tradingFallbackResultCode,
            firstSourceImageProof: singleImageProof,
            finalEpsUrls: Array.isArray(normalized.payload.images)
              ? normalized.payload.images.slice(0, 5)
              : [],
            cacheHits: normalized.diagnostics.cacheHits,
            freshUploads: normalized.diagnostics.freshUploads,
            finalSlotOrder: normalized.diagnostics.finalSlotOrder.slice(0, 5),
          },
          readyToPublishEvidence: {
            tempListingId,
            beforeNormalizationState: validateListingReadyImageState(payload, response),
            markReadyBefore: readyBefore,
            markReadyAfter: readyAfter,
            finalTempListingStatus: tempRow.status,
            finalTempImageValidation: validateEbayImageHosting(tempRow.payload),
          },
          liveReviseEvidence: {
            sku,
            inventoryPutStatus: inventoryPutResponse.status,
            inventoryPutOk: inventoryPutResponse.ok,
            inventoryPutBody,
            inventoryGetStatus: inventoryGetResponse.status,
            inventoryGetOk: inventoryGetResponse.ok,
            inventoryImageUrls: Array.isArray(inventoryGetParsed?.product && (inventoryGetParsed.product as Record<string, unknown>).imageUrls)
              ? ((inventoryGetParsed?.product as Record<string, unknown>).imageUrls as unknown[]).map(String)
              : [],
            finalPublishBoundaryValidation: validateEbayImageHosting(normalized.payload),
          },
          failurePathEvidence: {
            diagnostics: controlledFailure.diagnostics,
            readyState: validateListingReadyImageState(controlledFailure.payload, controlledFailure.response),
          },
        },
        null,
        2
      )
    );
  } finally {
    if (tempListingId) {
      await client.query(`DELETE FROM listings WHERE id = $1`, [tempListingId]);
    }
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
