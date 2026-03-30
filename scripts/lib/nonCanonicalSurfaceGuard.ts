type GuardInput = {
  scriptName: string;
  blockedAction: string;
  canonicalAction: string;
  mutatesState: boolean;
};

function isEnabled(v: string | undefined): boolean {
  return String(v ?? "false").trim().toLowerCase() === "true";
}

async function emitViolation(input: {
  scriptName: string;
  blockedAction: string;
  reason: string;
  severity?: "HIGH" | "CRITICAL";
  details?: Record<string, unknown>;
}) {
  try {
    const { writeAuditLog } = await import("@/lib/audit/writeAuditLog");
    await writeAuditLog({
      actorType: "SYSTEM",
      actorId: `script:${input.scriptName}`,
      entityType: "CONTROL_PLANE",
      entityId: input.scriptName,
      eventType: "CANONICAL_ENFORCEMENT_BLOCKED",
      details: {
        code: "NON_CANONICAL_SCRIPT_QUARANTINED",
        severity: input.severity ?? "CRITICAL",
        violationType: "non_canonical_script_surface",
        blockedAction: input.blockedAction,
        executionPath: `scripts/${input.scriptName}`,
        reason: input.reason,
        ...(input.details ?? {}),
      },
    });
  } catch {
    // best effort only; local diagnostics should still fail closed
  }
}

export async function assertNonCanonicalScriptAccess(input: GuardInput): Promise<void> {
  const engineeringMode = isEnabled(process.env.NON_CANONICAL_ENGINEERING_MODE);
  const controlledRepairPath = isEnabled(process.env.CONTROLLED_REPAIR_PATH);

  if (!engineeringMode) {
    const reason = `non-canonical script surface is quarantined; use ${input.canonicalAction}`;
    await emitViolation({
      scriptName: input.scriptName,
      blockedAction: input.blockedAction,
      reason,
      details: {
        canonicalAction: input.canonicalAction,
        mutatesState: input.mutatesState,
      },
    });
    throw new Error(
      `[${input.scriptName}] blocked by canonical enforcement. ${reason}. ` +
        "Set NON_CANONICAL_ENGINEERING_MODE=true only for engineering diagnostics/repair."
    );
  }

  if (input.mutatesState && !controlledRepairPath) {
    const reason = "state mutation requires CONTROLLED_REPAIR_PATH=true in engineering mode";
    await emitViolation({
      scriptName: input.scriptName,
      blockedAction: input.blockedAction,
      reason,
      severity: "HIGH",
      details: {
        canonicalAction: input.canonicalAction,
        controlledRepairPath,
      },
    });
    throw new Error(
      `[${input.scriptName}] blocked by canonical enforcement. ${reason}. ` +
        `Use canonical path ${input.canonicalAction} for normal operation.`
    );
  }
}
