import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    service: "QuickAIBuy Engine",
    status: "healthy",
    timestamp: new Date().toISOString(),
  });
}
