import { NextResponse } from "next/server";
import { sql } from "@/src/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await sql`
      SELECT id, worker, started_at, finished_at, ok, error, stats
      FROM worker_runs
      ORDER BY started_at DESC
      LIMIT 20
    `;

    return NextResponse.json({
      ok: true,
      rows,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 500 }
    );
  }
}
