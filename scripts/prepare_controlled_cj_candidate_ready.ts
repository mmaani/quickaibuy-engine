import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

type CurationConfig = {
  title: string;
  price: number;
  type: string;
  benefits: string[];
  shipping: string;
  trust: string;
};

const CURATIONS: Record<string, CurationConfig> = {
  "1395203143872155648": {
    title: "Wireless Wooden Bluetooth Desktop Speaker",
    price: 24.99,
    type: "Bluetooth Speaker",
    benefits: [
      "Compact wooden speaker design that fits desks, shelves, and bedside setups",
      "Bluetooth audio playback for phones, tablets, and everyday listening",
      "Clean, giftable look without bulky hardware",
    ],
    shipping: "Ships from the supplier warehouse shown in the latest CJ snapshot. Delivery timing remains operator-controlled and should be reviewed before publish.",
    trust: "Prepared from a direct CJ product page with live availability evidence and matched against a live eBay reference listing.",
  },
  "1758751299367079936": {
    title: "RGB Night Light Wireless Charger Bluetooth Speaker",
    price: 24.99,
    type: "Night Light Speaker",
    benefits: [
      "Combines ambient lighting, Bluetooth audio, and wireless charging in one unit",
      "Statement-style bedside or desk accessory for home setups",
      "Useful gift item with clear utility beyond basic speaker listings",
    ],
    shipping: "Ships from the supplier warehouse shown in the latest CJ snapshot. Delivery timing remains operator-controlled and should be reviewed before publish.",
    trust: "Prepared from a direct CJ product page with live availability evidence and matched against a live eBay reference listing.",
  },
  "2506210617111620600": {
    title: "White Noise Bluetooth Speaker with 15W Wireless Charger",
    price: 22.99,
    type: "Wireless Charger Speaker",
    benefits: [
      "Pairs white-noise playback with Bluetooth speaker functionality",
      "Integrated 15W wireless charging adds bedside convenience",
      "Useful for sleep, desk, and nightstand use cases",
    ],
    shipping: "Ships from the supplier warehouse shown in the latest CJ snapshot. Delivery timing remains operator-controlled and should be reviewed before publish.",
    trust: "Prepared from a direct CJ product page with live availability evidence and matched against a live eBay reference listing.",
  },
  "04AF4351-7F6B-471D-81C0-DBF17E5CD296": {
    title: "Bluetooth Alarm Clock Speaker",
    price: 19.99,
    type: "Alarm Clock Speaker",
    benefits: [
      "Combines a bedside alarm clock layout with Bluetooth speaker utility",
      "Compact everyday-use product with straightforward listing appeal",
      "Entry-price item suited to a controlled first-wave catalog",
    ],
    shipping: "Ships from the supplier warehouse shown in the latest CJ snapshot. Delivery timing remains operator-controlled and should be reviewed before publish.",
    trust: "Prepared from a direct CJ product page with live availability evidence and a lower-confidence but price-aligned eBay title match that still requires manual review before publish.",
  },
};

function buildDescription(config: CurationConfig): string {
  const lines = [
    config.title,
    "",
    "Benefits:",
    ...config.benefits.map((benefit) => `- ${benefit}`),
    "",
    "Shipping:",
    config.shipping,
    "",
    "Trust:",
    config.trust,
  ];

  return lines.join("\n").trim();
}

async function main() {
  const candidateId = String(process.argv[2] ?? "").trim();
  if (!candidateId) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/prepare_controlled_cj_candidate_ready.ts <candidate_id>"
    );
  }

  const { db } = await import("@/lib/db");
  const { sql } = await import("drizzle-orm");
  const { prepareListingPreviewForCandidate } = await import("@/lib/listings/prepareListingPreviews");
  const { markListingReadyToPublish } = await import("@/lib/listings/markListingReadyToPublish");

  const candidateResult = await db.execute(sql`
    SELECT
      pc.id::text AS candidate_id,
      pc.supplier_product_id AS supplier_product_id,
      pc.decision_status AS decision_status,
      pc.listing_eligible AS listing_eligible
    FROM profitable_candidates pc
    WHERE pc.id = ${candidateId}
    LIMIT 1
  `);

  const candidate = candidateResult.rows[0] as
    | {
        candidate_id: string;
        supplier_product_id: string;
        decision_status: string;
        listing_eligible: boolean;
      }
    | undefined;

  if (!candidate) {
    throw new Error(`candidate not found: ${candidateId}`);
  }

  if (candidate.decision_status !== "APPROVED" || !candidate.listing_eligible) {
    throw new Error(`candidate not APPROVED + listing_eligible: ${candidateId}`);
  }

  const curation = CURATIONS[candidate.supplier_product_id];
  if (!curation) {
    throw new Error(`no exact-scope curation config for supplier_product_id ${candidate.supplier_product_id}`);
  }

  await prepareListingPreviewForCandidate(candidateId, {
    marketplace: "ebay",
    forceRefresh: true,
  });

  const listingResult = await db.execute(sql`
    SELECT
      l.id::text AS listing_id,
      l.status,
      l.payload
    FROM listings l
    WHERE l.candidate_id = ${candidateId}
      AND l.marketplace_key = 'ebay'
      AND l.status = 'PREVIEW'
    ORDER BY l.updated_at DESC, l.created_at DESC
    LIMIT 1
  `);

  const listing = listingResult.rows[0] as
    | {
        listing_id: string;
        status: string;
        payload: Record<string, unknown>;
      }
    | undefined;

  if (!listing) {
    throw new Error(`no PREVIEW listing found after prepare for candidate ${candidateId}`);
  }

  const payload = (listing.payload ?? {}) as Record<string, unknown>;
  const updatedPayload: Record<string, unknown> = {
    ...payload,
    title: curation.title,
    price: curation.price,
    description: buildDescription(curation),
    brand: "Unbranded",
    mpn: "Does Not Apply",
    itemSpecifics: {
      Brand: "Unbranded",
      MPN: "Does Not Apply",
      Type: curation.type,
    },
  };

  await db.execute(sql`
    UPDATE listings
    SET
      title = ${curation.title},
      price = ${String(curation.price)},
      payload = ${updatedPayload},
      updated_at = NOW()
    WHERE id = ${listing.listing_id}
  `);

  const promoteResult = await markListingReadyToPublish({
    listingId: listing.listing_id,
    actorId: "prepare_controlled_cj_candidate_ready",
    actorType: "SYSTEM",
  });

  if (!promoteResult.ok) {
    throw new Error(promoteResult.reason || "failed to promote listing to READY_TO_PUBLISH");
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        candidateId,
        supplierProductId: candidate.supplier_product_id,
        listingId: listing.listing_id,
        title: curation.title,
        price: curation.price,
        promoteResult,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
