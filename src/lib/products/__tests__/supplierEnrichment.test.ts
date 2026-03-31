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
  assert.match(enrichment.shippingOriginEvidenceSource ?? "", /(origin_resolver|explicit_ship_from)/);
});

test("buildSupplierEnrichment preserves direct media quality when CJ-style video fields are present", () => {
  const enrichment = buildSupplierEnrichment({
    title: "Wireless charging led night light",
    sourceUrl: "https://cjdropshipping.com/product/test-p-ABCDEF12-3456-7890-ABCD-EF1234567890.html",
    images: [
      "https://cdn.example.com/1200x1200/1.jpg",
      "https://cdn.example.com/1200x1200/2.jpg",
      "https://cdn.example.com/1200x1200/3.jpg",
      "https://cdn.example.com/1200x1200/4.jpg",
      "https://cdn.example.com/1200x1200/5.jpg",
    ],
    shippingEstimates: [],
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.98,
    rawPayload: {
      mediaQualityScore: 0.94,
      videos: ["https://cdn.example.com/demo.mp4"],
      videoUrls: ["https://cdn.example.com/demo.mp4"],
      videoCount: 1,
      media: {
        videoUrls: ["https://cdn.example.com/demo.mp4"],
        videoCount: 1,
      },
    },
  });

  assert.equal(enrichment.mediaQualityScore, 0.94);
});

test("buildSupplierEnrichment collects canonical video urls from generic payload fields", () => {
  const enrichment = buildSupplierEnrichment({
    title: "Lamp",
    sourceUrl: "https://supplier.example.com/item/1",
    images: [
      "https://cdn.example.com/1.jpg",
      "https://cdn.example.com/2.jpg",
    ],
    shippingEstimates: [],
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.92,
    rawPayload: {
      video: "https://cdn.example.com/demo.mp4",
    },
  });

  assert.equal(enrichment.imageGalleryCount, 2);
  assert.ok(Number.isFinite(enrichment.mediaQualityScore));
});

test("buildSupplierEnrichment derives shipping evidence from structured option arrays", () => {
  const enrichment = buildSupplierEnrichment({
    title: "LED night light",
    sourceUrl: "https://supplier.example.com/item/2",
    images: ["https://cdn.example.com/1200x1200/1.jpg"],
    shippingEstimates: [],
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.92,
    rawPayload: {
      shipping: {
        options: [
          {
            method: "Express",
            cost: "4.50",
            currency: "USD",
            etaMinDays: 2,
            etaMaxDays: 5,
            shipFromCountry: "CN",
            destinationCountry: "US",
          },
        ],
      },
    },
  });

  assert.equal(enrichment.shippingMethod, "Express");
  assert.equal(enrichment.shippingPriceExplicit, "4.50");
  assert.equal(enrichment.shipFromCountry, "CN");
  assert.ok(enrichment.shippingConfidence >= 0.9);
});
