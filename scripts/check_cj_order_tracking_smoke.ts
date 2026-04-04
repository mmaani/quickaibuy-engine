import { getCjOrderDetail, getCjTrackingInfo } from "@/lib/suppliers/cj";

const orderId = String(process.argv[2] ?? "").trim();
const trackNumber = String(process.argv[3] ?? "").trim();

if (!orderId && !trackNumber) {
  console.error("Usage: node --import tsx scripts/check_cj_order_tracking_smoke.ts <orderId?> <trackNumber?>");
  process.exit(1);
}

const order = orderId ? await getCjOrderDetail(orderId).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : null;
const tracking = trackNumber ? await getCjTrackingInfo(trackNumber).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })) : null;

console.log(JSON.stringify({ orderId: orderId || null, trackNumber: trackNumber || null, order, tracking }, null, 2));
