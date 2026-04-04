import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { createCjOrder, formatCjErrorForOperator, getCjOrderDetail } from "@/lib/suppliers/cj";
import { prepareCjOrderProofHarnessRun } from "@/lib/suppliers/cj/orderProofHarness";

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function writeProofAudit(eventType: string, entityId: string, actorId: string, details: Record<string, unknown>) {
  await writeAuditLog({
    actorType: "SCRIPT",
    actorId,
    entityType: "CJ_PROOF_HARNESS",
    entityId,
    eventType,
    details,
  });
}

async function main() {
  const prepared = prepareCjOrderProofHarnessRun();

  await writeProofAudit(
    prepared.execute ? "CJ_ORDER_CREATE_PROOF_EXECUTION_REQUESTED" : "CJ_ORDER_CREATE_PROOF_PRECHECK",
    prepared.entityId,
    prepared.actorId,
    {
      runId: prepared.runId,
      execute: prepared.execute,
      maskedInput: prepared.maskedInput,
      guardrails: prepared.guardrails,
      balancePaymentAttempted: false,
    }
  );

  if (!prepared.execute) {
    console.log(JSON.stringify({
      ok: true,
      mode: "DRY_RUN",
      runId: prepared.runId,
      actorId: prepared.actorId,
      entityId: prepared.entityId,
      guardrails: prepared.guardrails,
      maskedInput: prepared.maskedInput,
      balancePaymentAttempted: false,
      normalFlowProofStateChanged: false,
    }, null, 2));
    return;
  }

  try {
    const created = await createCjOrder(prepared.orderInput);
    const createdOrderId = cleanString(created.orderId) ?? cleanString(created.cjOrderId) ?? cleanString(created.orderNum);
    if (!createdOrderId) {
      throw new Error("CJ proof harness createOrder returned no usable order identifier");
    }

    const detail = await getCjOrderDetail(createdOrderId);
    const proofResult = {
      ok: true,
      mode: "EXECUTED",
      runId: prepared.runId,
      actorId: prepared.actorId,
      guardrails: prepared.guardrails,
      maskedInput: prepared.maskedInput,
      createdOrder: {
        orderId: created.orderId,
        cjOrderId: created.cjOrderId,
        orderNum: created.orderNum,
        orderStatus: created.orderStatus,
        logisticName: created.logisticName,
        cjPayUrlPresent: Boolean(created.cjPayUrl),
      },
      detail: {
        orderId: detail.orderId,
        cjOrderId: detail.cjOrderId,
        orderNum: detail.orderNum,
        orderStatus: detail.orderStatus,
        logisticName: detail.logisticName,
        fromCountryCode: detail.fromCountryCode,
        trackNumberPresent: Boolean(detail.trackNumber),
      },
      balancePaymentAttempted: false,
      normalFlowProofStateChanged: false,
    };

    await writeProofAudit("CJ_ORDER_CREATE_PROOF_SUCCEEDED", prepared.entityId, prepared.actorId, proofResult);
    console.log(JSON.stringify(proofResult, null, 2));
  } catch (error) {
    const formatted = formatCjErrorForOperator(error);
    const failure = {
      ok: false,
      mode: "EXECUTED",
      runId: prepared.runId,
      actorId: prepared.actorId,
      guardrails: prepared.guardrails,
      maskedInput: prepared.maskedInput,
      error: formatted,
      balancePaymentAttempted: false,
      normalFlowProofStateChanged: false,
    };

    await writeProofAudit("CJ_ORDER_CREATE_PROOF_FAILED", prepared.entityId, prepared.actorId, failure);
    console.error(JSON.stringify(failure, null, 2));
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  const actorId = cleanString(process.env.CJ_PROOF_OPERATOR_ID) ?? "unknown-operator";
  const formatted = formatCjErrorForOperator(error);
  const failure = {
    ok: false,
    mode: "PRECHECK",
    actorId,
    error: formatted,
    balancePaymentAttempted: false,
    normalFlowProofStateChanged: false,
  };

  try {
    await writeProofAudit("CJ_ORDER_CREATE_PROOF_PRECHECK_FAILED", "cj-proof-precheck", actorId, failure);
  } catch {}

  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
});
