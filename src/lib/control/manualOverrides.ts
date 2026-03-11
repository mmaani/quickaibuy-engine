import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import { db } from "@/lib/db";
import { manualOverrides } from "@/lib/db/schema";

export const MANUAL_OVERRIDE_KEYS = [
  "PAUSE_PUBLISHING",
  "PAUSE_MARKETPLACE_SCAN",
  "PAUSE_ORDER_SYNC",
  "EMERGENCY_READ_ONLY",
] as const;

export type ManualOverrideKey = (typeof MANUAL_OVERRIDE_KEYS)[number];

export type ManualOverrideEntry = {
  key: ManualOverrideKey;
  enabled: boolean;
  note: string | null;
  changedBy: string | null;
  changedAt: string | null;
};

export type ManualOverrideSnapshot = {
  available: boolean;
  entries: Record<ManualOverrideKey, ManualOverrideEntry>;
  activeCount: number;
  emergencyReadOnly: boolean;
  limitations: string[];
};

const DEFAULT_NOTE = "No note provided.";

async function tableExists(): Promise<boolean> {
  const rows = await db.execute<{ exists: boolean }>(sql`
    select exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = 'manual_overrides'
    ) as exists
  `);
  return Boolean(rows.rows?.[0]?.exists);
}

function buildDefaultEntries(): Record<ManualOverrideKey, ManualOverrideEntry> {
  return MANUAL_OVERRIDE_KEYS.reduce(
    (acc, key) => {
      acc[key] = {
        key,
        enabled: false,
        note: null,
        changedBy: null,
        changedAt: null,
      };
      return acc;
    },
    {} as Record<ManualOverrideKey, ManualOverrideEntry>
  );
}

export async function getManualOverrideSnapshot(): Promise<ManualOverrideSnapshot> {
  const available = await tableExists();
  const entries = buildDefaultEntries();

  if (!available) {
    return {
      available: false,
      entries,
      activeCount: 0,
      emergencyReadOnly: true,
      limitations: [
        "Manual override store is unavailable. Mutating admin control actions are blocked for safety.",
      ],
    };
  }

  const rows = await db
    .select({
      controlKey: manualOverrides.controlKey,
      isEnabled: manualOverrides.isEnabled,
      note: manualOverrides.note,
      changedBy: manualOverrides.changedBy,
      changedAt: manualOverrides.changedAt,
    })
    .from(manualOverrides);

  for (const row of rows) {
    const key = String(row.controlKey) as ManualOverrideKey;
    if (!MANUAL_OVERRIDE_KEYS.includes(key)) continue;
    entries[key] = {
      key,
      enabled: Boolean(row.isEnabled),
      note: row.note ?? null,
      changedBy: row.changedBy ?? null,
      changedAt: row.changedAt ? row.changedAt.toISOString() : null,
    };
  }

  const activeCount = MANUAL_OVERRIDE_KEYS.filter((key) => entries[key].enabled).length;

  return {
    available: true,
    entries,
    activeCount,
    emergencyReadOnly: entries.EMERGENCY_READ_ONLY.enabled,
    limitations: [
      "Current enforcement is guaranteed for /admin/control quick actions and override toggles.",
      "If other entry points are added later, wire this shared override snapshot before enabling mutations.",
    ],
  };
}

export async function setManualOverride(input: {
  key: ManualOverrideKey;
  enabled: boolean;
  note?: string | null;
  actorId?: string | null;
}) {
  const available = await tableExists();
  if (!available) {
    throw new Error("Manual override store is unavailable. Apply DB migration first.");
  }

  const existing = await db
    .select({
      id: manualOverrides.id,
      isEnabled: manualOverrides.isEnabled,
      note: manualOverrides.note,
      changedBy: manualOverrides.changedBy,
      changedAt: manualOverrides.changedAt,
    })
    .from(manualOverrides)
    .where(eq(manualOverrides.controlKey, input.key))
    .limit(1);

  const previous = existing[0];
  const now = new Date();
  const note = (input.note ?? "").trim() || DEFAULT_NOTE;

  await db
    .insert(manualOverrides)
    .values({
      controlKey: input.key,
      isEnabled: input.enabled,
      note,
      changedBy: input.actorId ?? null,
      changedAt: now,
    })
    .onConflictDoUpdate({
      target: manualOverrides.controlKey,
      set: {
        isEnabled: input.enabled,
        note,
        changedBy: input.actorId ?? null,
        changedAt: now,
      },
    });

  await writeAuditLog({
    actorType: "ADMIN",
    actorId: input.actorId ?? null,
    entityType: "MANUAL_OVERRIDE",
    entityId: input.key,
    eventType: "MANUAL_OVERRIDE_UPDATED",
    details: {
      control: input.key,
      previousState: previous
        ? {
            enabled: previous.isEnabled,
            note: previous.note,
            changedBy: previous.changedBy,
            changedAt: previous.changedAt?.toISOString() ?? null,
          }
        : null,
      newState: {
        enabled: input.enabled,
        note,
        changedBy: input.actorId ?? null,
        changedAt: now.toISOString(),
      },
    },
  });
}
