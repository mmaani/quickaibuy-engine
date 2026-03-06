import { sql } from "drizzle-orm";
import { db } from "../db/index";

export async function writeAuditLog(params: {
  actorType: string;
  actorId?: string | null;
  entityType: string;
  entityId: string;
  eventType: string;
  details?: Record<string, unknown> | null;
}) {
  const {
    actorType,
    actorId = null,
    entityType,
    entityId,
    eventType,
    details = null,
  } = params;

  await db.execute(sql`
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
      ${actorType},
      ${actorId},
      ${entityType},
      ${entityId},
      ${eventType},
      ${details ? JSON.stringify(details) : null}::jsonb
    )
  `);
}
