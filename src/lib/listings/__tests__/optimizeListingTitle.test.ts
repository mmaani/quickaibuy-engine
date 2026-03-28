import test from "node:test";
import assert from "node:assert/strict";

import { optimizeListingTitle } from "@/lib/listings/optimizeListingTitle";

test("title sanitizer enforces 80-char limit and removes noisy phrases", () => {
  const title = optimizeListingTitle({
    marketplaceTitle: "NEW 2025 Hot Sale Portable Multifunction Wireless Speaker Free Shipping Fast Delivery",
    supplierTitle: null,
    supplierKey: "aliexpress",
    supplierProductId: "abc123",
  });

  assert.ok(title.length <= 80, `expected <= 80 chars, got ${title.length}`);
  assert.ok(!/hot sale|free shipping|fast delivery|multifunction/i.test(title));
});

test("title sanitizer removes duplicate tokens", () => {
  const title = optimizeListingTitle({
    marketplaceTitle: "Lamp Lamp lamp Crystal Crystal Decor Decor",
    supplierTitle: null,
    supplierKey: "temu",
    supplierProductId: "p-1",
  });

  const tokens = title.toLowerCase().split(/\s+/).filter(Boolean);
  for (let i = 1; i < tokens.length; i += 1) {
    assert.notEqual(tokens[i], tokens[i - 1], `adjacent duplicate token '${tokens[i]}' found in '${title}'`);
  }
});
