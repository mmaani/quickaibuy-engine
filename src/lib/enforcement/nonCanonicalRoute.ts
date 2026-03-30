import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";

function isEnabled(value: string | undefined): boolean {
  return String(value ?? "false").trim().toLowerCase() === "true";
}

export async function enforceNonCanonicalRouteQuarantine(input: {
  path: string;
  blockedAction: string;
  reason: string;
  code: string;
  actorId?: string;
  severity?: "HIGH" | "CRITICAL";
}) {
  const allowEngineeringRoute =
    process.env.NODE_ENV === "development" && isEnabled(process.env.ENABLE_ENGINEERING_NON_CANONICAL_ROUTES);

  if (allowEngineeringRoute) {
    return null;
  }

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: input.actorId ?? "non-canonical-route",
    entityType: "CONTROL_PLANE",
    entityId: input.path,
    eventType: "CANONICAL_ENFORCEMENT_BLOCKED",
    details: {
      code: input.code,
      severity: input.severity ?? "CRITICAL",
      violationType: "non_canonical_route_quarantine",
      blockedAction: input.blockedAction,
      executionPath: input.path,
      reason: input.reason,
      engineeringRouteEnabled: allowEngineeringRoute,
    },
  });

  return NextResponse.json(
    {
      ok: false,
      code: input.code,
      error: input.reason,
      guidance:
        "Use /admin/control or canonical package commands for supported operations. This surface is engineering-only and quarantined by default.",
    },
    { status: 410 }
  );
}
