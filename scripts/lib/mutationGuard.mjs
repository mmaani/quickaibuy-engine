import { getDbTargetContext, formatDbTargetBanner } from "./dbTarget.mjs";

function buildBlockedMessage(scriptName, context, missing) {
  return [
    `[${scriptName}] mutation blocked.`,
    formatDbTargetBanner(context),
    `Mutation safety=${context.mutationSafety.classification}.`,
    missing.length > 0 ? `Missing: ${missing.join(", ")}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
}

export function assertMutationAllowed(scriptName, options = {}) {
  const context = getDbTargetContext(options);
  const controlledRepairPath =
    String(process.env.CONTROLLED_REPAIR_PATH ?? "false").trim().toLowerCase() === "true";

  if (options.requireDev === true) {
    if (context.classification !== "DEV") {
      throw new Error(
        buildBlockedMessage(scriptName, context, ["DEV DB target required"])
      );
    }
  }

  if (!context.mutationSafety.allowed) {
    throw new Error(
      buildBlockedMessage(scriptName, context, context.mutationSafety.missing)
    );
  }

  if (!controlledRepairPath) {
    throw new Error(
      buildBlockedMessage(scriptName, context, [
        "CONTROLLED_REPAIR_PATH=true required for mutation scripts",
      ])
    );
  }

  console.log(`[${scriptName}] ${formatDbTargetBanner(context)} mutation safety=${context.mutationSafety.classification}`);
  return context;
}
