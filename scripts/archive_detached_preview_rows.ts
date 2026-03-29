import pg from "pg";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

const { Client } = pg;

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

  const client = new Client({
    connectionString: process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    await client.query("BEGIN");
    const updated: Array<Record<string, unknown>> = [];

    for (const target of targets) {
      const res = await client.query(
        `
          UPDATE listings l
          SET
            status = 'PUBLISH_FAILED',
            last_publish_error = COALESCE(NULLIF(l.last_publish_error, ''), '') ||
              CASE
                WHEN COALESCE(NULLIF(l.last_publish_error, ''), '') = '' THEN $2::text
                ELSE ' | ' || $2::text
              END,
            response = COALESCE(l.response, '{}'::jsonb) || jsonb_build_object(
              'recoveryState', 'BLOCKED_ORPHANED_PREVIEW',
              'publishBlocked', true,
              'requiresManualRecovery', true,
              'blockedAt', NOW(),
              'note', $2::text
            ),
            updated_at = NOW()
          WHERE l.id = $1::uuid
            AND l.status = 'PREVIEW'
            AND NOT EXISTS (
              SELECT 1
              FROM profitable_candidates pc
              WHERE pc.id = l.candidate_id
            )
          RETURNING l.id, l.candidate_id, l.status, l.updated_at
        `,
        [target.id, target.reason]
      );

      if (!res.rows.length) continue;

      await client.query(
        `
          INSERT INTO audit_log (
            id,
            event_ts,
            actor_type,
            actor_id,
            entity_type,
            entity_id,
            event_type,
            details
          )
          VALUES (
            gen_random_uuid(),
            NOW(),
            'ADMIN',
            'archive_detached_preview_rows.ts',
            'LISTING',
            $1::uuid,
            'LISTING_DETACHED_PREVIEW_ARCHIVED',
            jsonb_build_object(
              'listingId', $1::uuid,
              'reason', $2::text,
              'previousStatus', 'PREVIEW',
              'newStatus', 'PUBLISH_FAILED'
            )
          )
        `,
        [target.id, target.reason]
      );

      updated.push({
        ...res.rows[0],
        reason: target.reason,
      });
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, updatedCount: updated.length, updated }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
