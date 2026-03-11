import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";
import { runControlQuickAction } from "@/lib/control/runControlQuickAction";
import {
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

function blockedReason(action: string, snapshot: Awaited<ReturnType<typeof getManualOverrideSnapshot>>): string | null {
  if (!snapshot.available) return "Manual override store unavailable. Actions blocked for safety.";
  if (snapshot.entries.EMERGENCY_READ_ONLY.enabled) return "Emergency read-only mode is active.";
  if (
    snapshot.entries.PAUSE_PUBLISHING.enabled &&
    (action === "promote" || action === "dry-run" || action === "monitor" || action === "prepare")
  ) {
    return "Publishing is paused.";
  }
  if (snapshot.entries.PAUSE_MARKETPLACE_SCAN.enabled && action === "scan") {
    return "Marketplace scan is paused.";
  }
  if (snapshot.entries.PAUSE_ORDER_SYNC.enabled && action === "order-sync") {
    return "Order sync is paused.";
  }
  return null;
}

export async function POST(request: Request) {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    return NextResponse.redirect(new URL("/admin/review", request.url), 303);
  }

  const actorId = getReviewActorIdFromAuthorizationHeader(auth) ?? "admin";
  const formData = await request.formData();
  const action = String(formData.get("actionKey") ?? "").trim();

  const overrideSnapshot = await getManualOverrideSnapshot();
  const reason = blockedReason(action, overrideSnapshot);
  if (reason) {
    return NextResponse.redirect(
      new URL(`/admin/control?actionError=${encodeURIComponent(reason)}`, request.url),
      303
    );
  }

  try {
    const message = await runControlQuickAction(action, actorId);
    return NextResponse.redirect(
      new URL(`/admin/control?actionMessage=${encodeURIComponent(message)}`, request.url),
      303
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Action failed";
    return NextResponse.redirect(
      new URL(`/admin/control?actionError=${encodeURIComponent(msg)}`, request.url),
      303
    );
  }
}
