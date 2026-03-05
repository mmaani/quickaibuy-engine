import { NextResponse } from "next/server";
import { engineQueue } from "@/src/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const job = await engineQueue.add("ping", { hello: "world" }, { removeOnComplete: true });
  return NextResponse.json({ ok: true, jobId: job.id });
}
