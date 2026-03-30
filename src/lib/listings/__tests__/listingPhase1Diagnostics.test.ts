import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateListingEvolutionCandidate,
  evaluateListingKillDecision,
} from "@/lib/listings/listingPhase1Diagnostics";

test("healthy listing returns KEEP", () => {
  const result = evaluateListingKillDecision({
    impressions: 1200,
    clicks: 90,
    orders: 9,
    ctr: 0.075,
    conversionRate: 0.1,
    listingAgeDays: 14,
  });

  assert.equal(result.kill_decision, "KEEP");
  assert.ok(result.kill_score >= 0.8);
});

test("weak but recoverable listing returns EVOLVE_FIRST", () => {
  const result = evaluateListingKillDecision({
    impressions: 900,
    clicks: 16,
    orders: 1,
    ctr: 0.006,
    conversionRate: 0.02,
    listingAgeDays: 12,
  });

  assert.equal(result.kill_decision, "EVOLVE_FIRST");
});

test("low data listing biases to KEEP or MANUAL_REVIEW", () => {
  const result = evaluateListingKillDecision({
    impressions: 40,
    clicks: null,
    orders: 0,
    ctr: null,
    conversionRate: null,
    listingAgeDays: 2,
  });

  assert.ok(result.kill_decision === "KEEP" || result.kill_decision === "MANUAL_REVIEW");
  assert.ok(result.kill_reason_codes.includes("WEAK_EVIDENCE"));
});

test("clearly poor listing with enough data returns AUTO_KILL diagnostic", () => {
  const result = evaluateListingKillDecision({
    impressions: 2500,
    clicks: 12,
    orders: 0,
    ctr: 0.002,
    conversionRate: 0,
    listingAgeDays: 35,
  });

  assert.equal(result.kill_decision, "AUTO_KILL");
  assert.ok(result.kill_reason_codes.includes("DIAGNOSTIC_ONLY_PHASE1"));
});

test("conflicting evidence returns MANUAL_REVIEW", () => {
  const result = evaluateListingKillDecision({
    impressions: 700,
    clicks: 52,
    orders: 0,
    ctr: 0.05,
    conversionRate: 0,
    listingAgeDays: 20,
  });

  assert.equal(result.kill_decision, "MANUAL_REVIEW");
});

test("evolution chooses title/image candidate for CTR weakness", () => {
  const evolution = evaluateListingEvolutionCandidate({
    kill: { kill_score: 0.24, kill_decision: "EVOLVE_FIRST", kill_reason_codes: [], kill_evaluated_at: new Date().toISOString() },
    listingTitle: "Portable Night Light Lamp",
    supplierKey: "aliexpress",
    supplierProductId: "sku-1",
    impressions: 1000,
    clicks: 8,
    orders: 0,
    ctr: 0.004,
    conversionRate: 0,
    evolutionAttemptCount: 0,
    lastEvolutionAt: null,
    supplierTrustBand: "SAFE",
    listingResponse: {},
  });

  assert.equal(evolution.listing_evolution_status, "CANDIDATE_READY");
  assert.equal(evolution.listing_evolution_candidate_payload?.candidateType, "TITLE_IMAGE");
});

test("evolution chooses positioning/content candidate for conversion weakness", () => {
  const kill = evaluateListingKillDecision({
    impressions: 850,
    clicks: 55,
    orders: 0,
    ctr: 0.04,
    conversionRate: 0.004,
    listingAgeDays: 18,
  });
  const evolution = evaluateListingEvolutionCandidate({
    kill,
    listingTitle: "Desk Organizer Box",
    supplierKey: "aliexpress",
    supplierProductId: "sku-2",
    impressions: 850,
    clicks: 55,
    orders: 0,
    ctr: 0.04,
    conversionRate: 0.004,
    evolutionAttemptCount: 0,
    lastEvolutionAt: null,
    supplierTrustBand: "SAFE",
    listingResponse: {},
  });

  assert.equal(evolution.listing_evolution_status, "CANDIDATE_READY");
  assert.equal(evolution.listing_evolution_candidate_payload?.candidateType, "POSITIONING_CONTENT");
});

test("blocked supplier trust prevents evolution candidate", () => {
  const evolution = evaluateListingEvolutionCandidate({
    kill: { kill_score: 0.3, kill_decision: "EVOLVE_FIRST", kill_reason_codes: [], kill_evaluated_at: new Date().toISOString() },
    listingTitle: "Desk Lamp",
    supplierKey: "aliexpress",
    supplierProductId: "sku-3",
    impressions: 800,
    clicks: 20,
    orders: 0,
    ctr: 0.01,
    conversionRate: 0,
    evolutionAttemptCount: 0,
    lastEvolutionAt: null,
    supplierTrustBand: "BLOCK",
    listingResponse: {},
  });

  assert.equal(evolution.listing_evolution_status, "BLOCKED_SUPPLIER_TRUST");
  assert.equal(evolution.listing_evolution_candidate_payload, null);
});

test("unsafe verification blocks candidate", () => {
  const evolution = evaluateListingEvolutionCandidate({
    kill: { kill_score: 0.3, kill_decision: "EVOLVE_FIRST", kill_reason_codes: [], kill_evaluated_at: new Date().toISOString() },
    listingTitle: "Desk Lamp",
    supplierKey: "aliexpress",
    supplierProductId: "sku-4",
    impressions: 1000,
    clicks: 20,
    orders: 0,
    ctr: 0.01,
    conversionRate: 0,
    evolutionAttemptCount: 0,
    lastEvolutionAt: null,
    supplierTrustBand: "SAFE",
    listingResponse: { aiListing: { verification: { ok: false } } },
  });

  assert.equal(evolution.listing_evolution_status, "VERIFICATION_BLOCKED");
});

test("cooldown and bounded attempts are enforced", () => {
  const now = new Date("2026-03-30T00:00:00.000Z");
  const inCooldown = evaluateListingEvolutionCandidate({
    kill: { kill_score: 0.3, kill_decision: "EVOLVE_FIRST", kill_reason_codes: [], kill_evaluated_at: now.toISOString() },
    listingTitle: "Desk Lamp",
    supplierKey: "aliexpress",
    supplierProductId: "sku-5",
    impressions: 1000,
    clicks: 20,
    orders: 0,
    ctr: 0.005,
    conversionRate: 0,
    evolutionAttemptCount: 1,
    lastEvolutionAt: new Date("2026-03-29T12:00:00.000Z"),
    supplierTrustBand: "SAFE",
    listingResponse: {},
    now,
  });
  assert.equal(inCooldown.listing_evolution_status, "COOLDOWN");

  const attemptsExceeded = evaluateListingEvolutionCandidate({
    kill: { kill_score: 0.3, kill_decision: "EVOLVE_FIRST", kill_reason_codes: [], kill_evaluated_at: now.toISOString() },
    listingTitle: "Desk Lamp",
    supplierKey: "aliexpress",
    supplierProductId: "sku-6",
    impressions: 1000,
    clicks: 20,
    orders: 0,
    ctr: 0.005,
    conversionRate: 0,
    evolutionAttemptCount: 99,
    lastEvolutionAt: null,
    supplierTrustBand: "SAFE",
    listingResponse: {},
    now,
  });
  assert.equal(attemptsExceeded.listing_evolution_status, "ATTEMPT_LIMIT_REACHED");
});
