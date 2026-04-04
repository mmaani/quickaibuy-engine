import { extractTrackingNumber, formatCjErrorForOperator, getCjOrderDetail, getCjTrackingInfo, listCjOrders } from "@/lib/suppliers/cj";

function pickOrderId(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  for (const key of ["orderId", "cjOrderId", "id"]) {
    const raw = row[key];
    if (typeof raw === "string" && raw.trim()) return raw.trim();
  }
  return null;
}

async function main() {
  const orderIdArg = String(process.argv[2] ?? "").trim();
  const trackArg = String(process.argv[3] ?? "").trim();

  const listed = !orderIdArg && !trackArg ? await listCjOrders({ pageNum: 1, pageSize: 10 }) : [];
  const orderId = orderIdArg || pickOrderId((listed[0] ?? null) as Record<string, unknown> | null);
  const detail = orderId ? await getCjOrderDetail(orderId) : null;
  const trackNumber = trackArg || detail?.trackNumber || extractTrackingNumber(detail?.raw ?? null);
  if (!trackNumber) throw new Error("No CJ tracking number available for tracking validation");

  const tracking = await getCjTrackingInfo(trackNumber);
  const ok = Boolean(tracking?.trackingNumber);
  console.log(
    JSON.stringify(
      {
        ok,
        selectedOrderId: orderId || null,
        selectedTrackNumber: trackNumber,
        listedCount: listed.length,
        detail,
        tracking,
      },
      null,
      2
    )
  );
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
