import { NextResponse } from "next/server";
import { requirePipelineAdmin } from "@/lib/admin/requirePipelineAdmin";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = requirePipelineAdmin(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await pool.query(
      `
        SELECT
          id,
          worker,
          job_name,
          job_id,
          status,
          duration_ms,
          ok,
          error,
          stats,
          started_at,
          finished_at
        FROM worker_runs
        ORDER BY started_at DESC
        LIMIT 20
      `
    );

    return NextResponse.json({
      ok: true,
      rows: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
