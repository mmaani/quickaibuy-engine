import { NextResponse } from "next/server";
import { pool } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await pool.query(
      `
        SELECT id, event_ts, actor_type, actor_id, entity_type, entity_id, event_type, details
        FROM audit_log
        ORDER BY event_ts DESC
        LIMIT 30
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
