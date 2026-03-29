import { loadRuntimeEnv } from "@/lib/runtimeEnv";
import { failCloseOrphanedReadyToPublishListing } from "@/lib/listings/integrity";

loadRuntimeEnv();

async function main() {
  const listingId = String(process.argv[2] ?? "").trim();
  if (!listingId) {
    console.error("Usage: pnpm exec tsx scripts/fail_close_orphaned_listing.ts <listing_id>");
    process.exit(1);
  }

  await failCloseOrphanedReadyToPublishListing({
    listingId,
    actorId: "scripts/fail_close_orphaned_listing.ts",
    actorType: "ADMIN",
  });
  console.log(JSON.stringify({ ok: true, listingId }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
