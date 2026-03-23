import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { LOW_MATCH_CONFIDENCE_THRESHOLD } from "@/lib/review/console";
import { REVIEW_CONSOLE_REALM, getReviewConsoleCredentials, isAuthorizedReviewRequest } from "@/lib/review/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorizedResponse() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`,
      "Cache-Control": "no-store",
    },
  });
}

function maskDbUrlFingerprint(dbUrl: string | undefined): string | null {
  if (!dbUrl) return null;
  try {
    const parsed = new URL(dbUrl);
    const dbName = parsed.pathname.replace(/^\//, "") || "-";
    return `${parsed.hostname}/${dbName}`;
  } catch {
    return "invalid-db-url";
  }
}

export async function GET(request: NextRequest) {
  const configured = getReviewConsoleCredentials();
  if (!configured) {
    return new NextResponse("Review console auth is not configured.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }
  if (!isAuthorizedReviewRequest(request)) {
    return unauthorizedResponse();
  }

  const host = request.headers.get("host");

  const tableExistsRes = await pool.query<{ exists: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'listings'
      ) AS exists
    `
  );
  const listingsTableExists = Boolean(tableExistsRes.rows[0]?.exists);

  const approvedCountRes = await pool.query<{ n: string }>(
    `SELECT count(*)::int::text AS n FROM profitable_candidates WHERE decision_status = 'APPROVED'`
  );
  const approvedLatestRes = await pool.query<{ id: string }>(
    `
      SELECT id
      FROM profitable_candidates
      WHERE decision_status = 'APPROVED'
      ORDER BY calc_ts DESC NULLS LAST
      LIMIT 5
    `
  );

  const listingsCountRes = listingsTableExists
    ? await pool.query<{ n: string }>(`SELECT count(*)::int::text AS n FROM listings`)
    : { rows: [{ n: "0" }] };

  const dbFingerprintRes = await pool.query<{
    db_name: string;
  }>(
    `
      SELECT
        current_database() AS db_name
    `
  );

  return NextResponse.json(
    {
      ok: true,
      temporaryDebugRoute: true,
      host,
      reviewConsoleConfigured: true,
      lowMatchConfidenceThreshold: LOW_MATCH_CONFIDENCE_THRESHOLD,
      counts: {
        approvedCandidates: Number(approvedCountRes.rows[0]?.n ?? 0),
        listings: Number(listingsCountRes.rows[0]?.n ?? 0),
      },
      latestApprovedCandidateIds: approvedLatestRes.rows.map((row) => row.id),
      runtimeEnv: {
        VERCEL_ENV: process.env.VERCEL_ENV ?? null,
        VERCEL_URL: process.env.VERCEL_URL ?? null,
        NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV ?? null,
        NEXT_PUBLIC_VERCEL_URL: process.env.NEXT_PUBLIC_VERCEL_URL ?? null,
        VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
      dbFingerprint: {
        configuredDbHostAndName: maskDbUrlFingerprint(process.env.DATABASE_URL),
        connectedDatabase: dbFingerprintRes.rows[0]?.db_name ?? null,
        listingsTableExists,
      },
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
