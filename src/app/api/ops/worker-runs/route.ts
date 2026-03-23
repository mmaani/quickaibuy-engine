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
        SELECT *
        FROM (
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
            finished_at,
            ROW_NUMBER() OVER (
              PARTITION BY worker, job_name, job_id
              ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST, started_at DESC NULLS LAST, id DESC
            ) AS row_num
          FROM worker_runs
        ) runs
        WHERE row_num = 1
        ORDER BY COALESCE(finished_at, started_at) DESC NULLS LAST
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
