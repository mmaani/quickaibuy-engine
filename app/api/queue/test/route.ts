import { NextResponse } from "next/server";
import { engineQueue } from "@/src/lib/queue";

export async function POST() {
  const job = await engineQueue.add("ping", { at: new Date().toISOString() });
  return NextResponse.json({ ok: true, jobId: job.id });
}
