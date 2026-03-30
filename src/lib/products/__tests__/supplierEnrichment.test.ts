import test from "node:test";
import assert from "node:assert/strict";

import { buildSupplierEnrichment } from "@/lib/products/supplierEnrichment";

test("buildSupplierEnrichment extracts media from gallery + variant + description payload nodes", () => {
  const enrichment = buildSupplierEnrichment({
    title: "Portable blender bottle for travel gym smoothies",
    sourceUrl: "https://www.aliexpress.com/item/1005000000000.html",
    images: [],
    shippingEstimates: [],
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    rawPayload: {
      imageGallery: ["https://cdn.example.com/1200x1200/main.jpg"],
      variantImages: [{ image: "https://cdn.example.com/800x800/variant-red.jpg" }],
      description: {
        images: ["https://cdn.example.com/640x640/detail-1.jpg"],
      },
    },
  });

  assert.equal(enrichment.imageGalleryCount, 3);
  assert.ok(enrichment.normalizedImageUrls.includes("https://cdn.example.com/1200x1200/main.jpg"));
  assert.ok(enrichment.normalizedImageUrls.includes("https://cdn.example.com/800x800/variant-red.jpg"));
  assert.ok(enrichment.normalizedImageUrls.includes("https://cdn.example.com/640x640/detail-1.jpg"));
  assert.ok(Number.isFinite(enrichment.mediaQualityScore));
});

test("buildSupplierEnrichment allows strong inferred origin from consistent shipping evidence", () => {
  const enrichment = buildSupplierEnrichment({
    title: "Magnetic phone stand for car dashboard",
    sourceUrl: "https://www.aliexpress.com/item/1005000000001.html",
    images: ["https://cdn.example.com/1080x1080/main.jpg"],
    shippingEstimates: [
      {
        label: "AliExpress Standard Shipping",
        cost: "4.21",
        etaMinDays: 7,
        etaMaxDays: 12,
        ship_from_country: "China",
      },
    ],
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.86,
    rawPayload: {
      shippingSignal: "PARTIAL",
      shipping: {
        options: [{ destinationCountry: "US", shipFromCountry: "CN" }],
      },
    },
  });

  assert.equal(enrichment.shipFromCountry, "CN");
  assert.ok(enrichment.shipFromConfidence >= 0.75);
  assert.match(enrichment.shippingOriginEvidenceSource ?? "", /origin_resolver/);
});
