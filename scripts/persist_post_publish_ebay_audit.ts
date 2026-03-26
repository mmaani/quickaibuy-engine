import { persistPostPublishEbayAudit } from "@/lib/listings/persistPostPublishEbayAudit";

function getFlag(name: string): boolean {
  return process.argv.includes(name);
}

function getOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  const value = process.argv[index + 1];
  return value ? String(value).trim() : null;
}

async function main() {
  const listingId = getOption("--listing-id") ?? process.argv[2] ?? "";
  if (!listingId) {
    throw new Error("usage: pnpm exec tsx scripts/persist_post_publish_ebay_audit.ts --listing-id <uuid> [--dry-run] [--skip-live-fetch]");
  }

  const result = await persistPostPublishEbayAudit({
    listingId,
    actorId: "scripts/persist_post_publish_ebay_audit",
    trigger: "manual_script",
    persist: !getFlag("--dry-run"),
    preferLiveFetch: !getFlag("--skip-live-fetch"),
  });

  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
