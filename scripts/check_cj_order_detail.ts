import { formatCjErrorForOperator, getCjOrderDetail, listCjOrders } from "@/lib/suppliers/cj";

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
  const listed = orderIdArg ? [] : await listCjOrders({ pageNum: 1, pageSize: 5 });
  const orderId = orderIdArg || pickOrderId((listed[0] ?? null) as Record<string, unknown> | null);
  if (!orderId) throw new Error("No CJ order id available for order detail validation");

  const detail = await getCjOrderDetail(orderId);
  const ok = Boolean(detail.orderId || detail.cjOrderId || detail.orderNum);
  console.log(JSON.stringify({ ok, selectedOrderId: orderId, listedCount: listed.length, detail }, null, 2));
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
