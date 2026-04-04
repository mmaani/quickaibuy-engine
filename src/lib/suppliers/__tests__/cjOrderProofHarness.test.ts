import test from "node:test";
import assert from "node:assert/strict";

import { prepareCjOrderProofHarnessRun } from "@/lib/suppliers/cj/orderProofHarness";

test("CJ proof harness derives logisticName from first valid freight tip quote by default", async () => {
  const prepared = await prepareCjOrderProofHarnessRun({
    argv: [],
    now: new Date("2026-04-04T19:20:00.000Z"),
    env: {
      CJ_PROOF_HARNESS_MODE: "internal_non_customer",
      CJ_PROOF_OPERATOR_ID: "internal-proof-operator",
      CJ_PROOF_INTERNAL_MARKER: "INTERNAL PROOF",
      CJ_PROOF_INTERNAL_RECIPIENT_NAME: "Internal Proof Recipient",
      CJ_PROOF_INTERNAL_ADDRESS1: "QuickAiBuy Internal Office 123",
      CJ_PROOF_INTERNAL_CITY: "Austin",
      CJ_PROOF_INTERNAL_PROVINCE: "TX",
      CJ_PROOF_INTERNAL_ZIP: "78701",
      CJ_PROOF_INTERNAL_COUNTRY: "United States",
      CJ_PROOF_INTERNAL_COUNTRY_CODE: "US",
      CJ_PROOF_INTERNAL_PHONE: "+1 555 123 9999",
      CJ_PROOF_INTERNAL_EMAIL: "internal-proof@quickaibuy.com",
      CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE: "CN",
      CJ_PROOF_TEST_VIDS: "1681189962735165440",
    },
    queryVariantByVid: async () => ({ SKU: "CJ-SKU-1" }),
    calculateFreightTip: async () => [
      { errorEn: "bad route", option: { enName: "Ignored Invalid" } },
      { option: { enName: "YunExpress Sensitive" } },
      { option: { enName: "Another Route" } },
    ],
  });

  assert.equal(prepared.execute, false);
  assert.equal(prepared.orderInput.platform, "internal-proof");
  assert.equal(prepared.orderInput.logisticName, "YunExpress Sensitive");
  assert.equal(prepared.maskedInput.logisticSource, "freight-tip");
  assert.equal(prepared.maskedInput.freightTipQuoteCount, 3);
  assert.match(prepared.orderInput.orderNumber, /^CJ-PROOF-INTERNAL-/);
  assert.equal(prepared.maskedInput.balancePaymentAttempted, false);
  assert.equal(Array.isArray(prepared.orderInput.products), true);
  assert.equal(prepared.orderInput.products.length, 1);
});

test("CJ proof harness respects explicit logisticName override", async () => {
  const prepared = await prepareCjOrderProofHarnessRun({
    argv: [],
    env: {
      CJ_PROOF_HARNESS_MODE: "internal_non_customer",
      CJ_PROOF_OPERATOR_ID: "internal-proof-operator",
      CJ_PROOF_INTERNAL_RECIPIENT_NAME: "Internal Proof Recipient",
      CJ_PROOF_INTERNAL_ADDRESS1: "QuickAiBuy Internal Office 123",
      CJ_PROOF_INTERNAL_CITY: "Austin",
      CJ_PROOF_INTERNAL_PROVINCE: "TX",
      CJ_PROOF_INTERNAL_ZIP: "78701",
      CJ_PROOF_INTERNAL_COUNTRY: "United States",
      CJ_PROOF_INTERNAL_COUNTRY_CODE: "US",
      CJ_PROOF_INTERNAL_PHONE: "+1 555 123 9999",
      CJ_PROOF_INTERNAL_EMAIL: "internal-proof@quickaibuy.com",
      CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE: "CN",
      CJ_PROOF_INTERNAL_LOGISTIC_NAME: "Manual Override Route",
      CJ_PROOF_TEST_SKUS: "CJ-SKU-1",
    },
    calculateFreightTip: async () => {
      throw new Error("freight tip should not be called when manual override is explicit");
    },
  });

  assert.equal(prepared.orderInput.logisticName, "Manual Override Route");
  assert.equal(prepared.maskedInput.logisticSource, "manual-override");
  assert.equal(prepared.maskedInput.freightTipQuoteCount, 0);
});

test("CJ proof harness requires explicit confirmation before execute mode", async () => {
  await assert.rejects(
    () =>
      prepareCjOrderProofHarnessRun({
        argv: ["--execute"],
        env: {
          CJ_PROOF_HARNESS_MODE: "internal_non_customer",
          CJ_PROOF_OPERATOR_ID: "internal-proof-operator",
          CJ_PROOF_INTERNAL_RECIPIENT_NAME: "Internal Proof Recipient",
          CJ_PROOF_INTERNAL_ADDRESS1: "QuickAiBuy Internal Office 123",
          CJ_PROOF_INTERNAL_CITY: "Austin",
          CJ_PROOF_INTERNAL_PROVINCE: "TX",
          CJ_PROOF_INTERNAL_ZIP: "78701",
          CJ_PROOF_INTERNAL_COUNTRY: "United States",
          CJ_PROOF_INTERNAL_COUNTRY_CODE: "US",
          CJ_PROOF_INTERNAL_PHONE: "+1 555 123 9999",
          CJ_PROOF_INTERNAL_EMAIL: "internal-proof@quickaibuy.com",
          CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE: "CN",
          CJ_PROOF_TEST_SKUS: "CJ-SKU-1",
        },
      }),
    /CJ_PROOF_HARNESS_CONFIRM/
  );
});
