import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { getCustomerDetail } from "@/lib/customers/admin";
import {
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export async function GET(request: Request, context: { params: Promise<{ customerId: string }> }) {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { customerId } = await context.params;
  const detail = await getCustomerDetail(customerId);
  if (!detail.customer) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, ...detail });
}
