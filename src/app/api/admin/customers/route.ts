import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { listCustomers } from "@/lib/customers/admin";
import {
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export async function GET(request: Request) {
  const auth = (await headers()).get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(auth)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const country = url.searchParams.get("country");
  const city = url.searchParams.get("city");
  const repeat = (url.searchParams.get("repeat") ?? "all") as "repeat" | "first" | "all";
  const limit = Number(url.searchParams.get("limit") ?? "250");

  const rows = await listCustomers({ country, city, repeat, limit });
  return NextResponse.json({ ok: true, count: rows.length, rows });
}
