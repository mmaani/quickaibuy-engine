import test from "node:test";
import assert from "node:assert/strict";

import { classifySupplierEvidence } from "@/lib/products/supplierEvidenceClassification";
import { extractShippingEvidence } from "@/lib/products/suppliers/parserSignals";


test("shipping transparency is classified separately from missing shipping", () => {
  const result = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    shippingEstimates: [
      {
        label: "Standard Shipping",
        etaMinDays: 7,
        etaMaxDays: 12,
      },
    ],
    shippingConfidence: 0.63,
    imageCount: 4,
    mediaQualityScore: 0.9,
    sourceQuality: "HIGH",
    rawPayload: {
      shippingSignal: "PARTIAL",
      shippingEvidenceText: "Ships within 7 to 12 business days",
      shippingDestinationCountry: "US",
      actionableSnapshot: true,
    },
    telemetrySignals: ["parsed"],
  });

  assert.equal(result.codes.includes("SHIPPING_SIGNAL_MISSING"), false);
  assert.equal(result.codes.includes("SHIPPING_TRANSPARENCY_INCOMPLETE"), true);
  assert.equal(result.codes.includes("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT"), true);
});


test("missing media is distinct from weak media quality", () => {
  const missingMedia = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    shippingEstimates: [{ label: "Free shipping", cost: "0" }],
    shippingConfidence: 0.86,
    sourceQuality: "HIGH",
    rawPayload: { shippingSignal: "DIRECT", actionableSnapshot: true },
    telemetrySignals: ["parsed"],
  });
  assert.equal(missingMedia.codes.includes("MEDIA_MISSING"), true);

  const weakMedia = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.9,
    shippingEstimates: [{ label: "Free shipping", cost: "0" }],
    shippingConfidence: 0.86,
    imageCount: 2,
    sourceQuality: "HIGH",
    rawPayload: {
      shippingSignal: "DIRECT",
      actionableSnapshot: true,
      images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
    },
    telemetrySignals: ["parsed"],
  });
  assert.equal(weakMedia.codes.includes("MEDIA_PRESENT_QUALITY_WEAK"), true);
  assert.equal(weakMedia.codes.includes("MEDIA_MISSING"), false);
});

test("structured shipping evidence does not regress to shipping missing when origin is unresolved", () => {
  const result = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.92,
    shippingConfidence: 0.72,
    sourceQuality: "HIGH",
    rawPayload: {
      shippingSignal: "MISSING",
      shippingDestinationCountry: "US",
      actionableSnapshot: true,
      shipping: {
        options: [
          {
            destinationCountry: "US",
            method: "AliExpress Standard Shipping",
            etaMinDays: 7,
            etaMaxDays: 11,
          },
        ],
      },
    },
    telemetrySignals: ["parsed"],
  });

  assert.equal(result.codes.includes("SHIPPING_SIGNAL_MISSING"), false);
  assert.equal(result.codes.includes("SHIP_FROM_UNRESOLVED_DESTINATION_CONTEXT"), true);
});

test("structured media arrays count as present media evidence", () => {
  const result = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.91,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.22" }],
    shippingConfidence: 0.86,
    sourceQuality: "HIGH",
    rawPayload: {
      shippingSignal: "DIRECT",
      actionableSnapshot: true,
      imageGalleryCount: 3,
      galleryImages: ["https://cdn.example.com/a.jpg"],
      variantImages: ["https://cdn.example.com/b.jpg"],
      descriptionImages: ["https://cdn.example.com/c.jpg"],
      media: {
        imageCount: 3,
      },
    },
    telemetrySignals: ["parsed"],
  });

  assert.equal(result.codes.includes("MEDIA_MISSING"), false);
});

test("nested media arrays count as canonical media evidence", () => {
  const result = classifySupplierEvidence({
    availabilitySignal: "IN_STOCK",
    availabilityConfidence: 0.91,
    shippingEstimates: [{ label: "AliExpress Standard Shipping", cost: "4.22" }],
    shippingConfidence: 0.86,
    sourceQuality: "HIGH",
    rawPayload: {
      shippingSignal: "DIRECT",
      actionableSnapshot: true,
      media: {
        galleryImages: ["https://cdn.example.com/a.jpg"],
        variantImages: ["https://cdn.example.com/b.jpg"],
        descriptionImages: ["https://cdn.example.com/c.jpg"],
        videoUrls: ["https://cdn.example.com/demo.mp4"],
        imageCount: 3,
        videoCount: 1,
      },
    },
    telemetrySignals: ["parsed"],
  });

  assert.equal(result.codes.includes("MEDIA_MISSING"), false);
});


test("parser extracts ship-from and destination-aware shipping evidence", () => {
  const shipping = extractShippingEvidence(
    "Ships from Germany warehouse. Shipping to United States: $4.99. Estimated delivery 5 to 8 business days."
  );

  assert.equal(shipping.signal, "DIRECT");
  assert.equal(shipping.shipFromCountry, "DE");
  assert.equal(shipping.shippingEstimates.length, 1);
  assert.equal(shipping.shippingEstimates[0]?.etaMinDays, 5);
  assert.equal(shipping.shippingEstimates[0]?.etaMaxDays, 8);
});
