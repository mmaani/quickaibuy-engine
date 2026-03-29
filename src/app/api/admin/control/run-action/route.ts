import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getManualOverrideSnapshot } from "@/lib/control/manualOverrides";
import { getControlQuickActionBlockedReason } from "@/lib/control/controlQuickActions";
import { runControlQuickAction } from "@/lib/control/runControlQuickAction";
import {
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export async function POST(request: Request) {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    return NextResponse.redirect(new URL("/admin/review", request.url), 303);
  }

  const actorId = getReviewActorIdFromAuthorizationHeader(auth) ?? "admin";
  const formData = await request.formData();
  const action = String(formData.get("actionKey") ?? "").trim();

  const overrideSnapshot = await getManualOverrideSnapshot();
  const reason = getControlQuickActionBlockedReason(action, overrideSnapshot);
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
