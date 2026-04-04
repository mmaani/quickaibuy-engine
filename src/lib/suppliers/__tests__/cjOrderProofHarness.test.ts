import test from "node:test";
import assert from "node:assert/strict";

import { prepareCjOrderProofHarnessRun } from "@/lib/suppliers/cj/orderProofHarness";

test("CJ proof harness defaults to dry-run and masks internal operator inputs", () => {
  const prepared = prepareCjOrderProofHarnessRun({
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
      CJ_PROOF_INTERNAL_LOGISTIC_NAME: "CJPacket Ordinary",
      CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE: "CN",
      CJ_PROOF_TEST_VIDS: "1681189962735165440",
    },
  });

  assert.equal(prepared.execute, false);
  assert.equal(prepared.orderInput.platform, "internal-proof");
  assert.match(prepared.orderInput.orderNumber, /^CJ-PROOF-INTERNAL-/);
  assert.equal(prepared.maskedInput.balancePaymentAttempted, false);
  assert.equal(Array.isArray(prepared.orderInput.products), true);
  assert.equal(prepared.orderInput.products.length, 1);
});

test("CJ proof harness requires explicit confirmation before execute mode", () => {
  assert.throws(
    () =>
      prepareCjOrderProofHarnessRun({
        argv: ["--execute"],
        env: {
          CJ_PROOF_HARNESS_MODE: "internal_non_customer",
          CJ_PROOF_OPERATOR_ID: "internal-proof-operator",
          CJ_PLATFORM_TOKEN: "platform-token",
          CJ_PROOF_INTERNAL_RECIPIENT_NAME: "Internal Proof Recipient",
          CJ_PROOF_INTERNAL_ADDRESS1: "QuickAiBuy Internal Office 123",
          CJ_PROOF_INTERNAL_CITY: "Austin",
          CJ_PROOF_INTERNAL_PROVINCE: "TX",
          CJ_PROOF_INTERNAL_ZIP: "78701",
          CJ_PROOF_INTERNAL_COUNTRY: "United States",
          CJ_PROOF_INTERNAL_COUNTRY_CODE: "US",
          CJ_PROOF_INTERNAL_PHONE: "+1 555 123 9999",
          CJ_PROOF_INTERNAL_EMAIL: "internal-proof@quickaibuy.com",
          CJ_PROOF_INTERNAL_LOGISTIC_NAME: "CJPacket Ordinary",
          CJ_PROOF_INTERNAL_FROM_COUNTRY_CODE: "CN",
          CJ_PROOF_TEST_VIDS: "1681189962735165440",
        },
      }),
    /CJ_PROOF_HARNESS_CONFIRM/
  );
});
