import { NextResponse } from "next/server";
import { engineQueue } from "@/src/lib/bull";
import { JOBS } from "@/src/lib/jobNames";
import { enforceNonCanonicalRouteQuarantine } from "@/lib/enforcement/nonCanonicalRoute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const blocked = await enforceNonCanonicalRouteQuarantine({
    path: "api/queue/test",
    blockedAction: "queue-test-enqueue",
    code: "QUEUE_TEST_ROUTE_QUARANTINED",
    reason: "queue test route is non-canonical and quarantined by default",
    actorId: "queue.test.route",
  });
  if (blocked) return blocked;

  const job = await engineQueue.add(JOBS.SCAN_SUPPLIER, {
    source: "demo",
    url: "https://example.com",
  });

  return NextResponse.json({
    ok: true,
    jobId: job.id,
  });
}
