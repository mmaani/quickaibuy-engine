import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";
import { archiveDetachedPreviewListing } from "@/lib/listings/integrity";

type TargetRow = {
  id: string;
  reason: string;
};

function readTargets(): TargetRow[] {
  const raw = process.argv.slice(2);
  if (!raw.length || raw.length % 2 !== 0) {
    console.error(
      "Usage: node --import tsx scripts/archive_detached_preview_rows.ts <listing_id> <reason> [<listing_id> <reason> ...]"
    );
    process.exit(1);
  }

  const rows: TargetRow[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const id = String(raw[i] ?? "").trim();
    const reason = String(raw[i + 1] ?? "").trim();
    if (!id || !reason) {
      console.error("Each listing_id must be paired with a non-empty reason.");
      process.exit(1);
    }
    rows.push({ id, reason });
  }
  return rows;
}

async function main() {
  loadRuntimeEnv();
  assertMutationAllowed("archive_detached_preview_rows.ts");
  const targets = readTargets();
  const updated: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const row = await archiveDetachedPreviewListing({
      listingId: target.id,
      reason: target.reason,
      actorId: "archive_detached_preview_rows.ts",
      actorType: "ADMIN",
    });
    if (!row) continue;
    updated.push({
      ...row,
      reason: target.reason,
    });
  }

  console.log(JSON.stringify({ ok: true, updatedCount: updated.length, updated }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
