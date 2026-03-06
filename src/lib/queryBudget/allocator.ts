import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { enqueueProductDiscoverTask } from "../jobs/enqueueTrendExpand";

type BudgetRow = {
  source: string;
  period: string;
  max_queries: number;
  used_queries: number;
  reset_at: Date | string;
};

type QueryTaskPick = {
  id: string;
  candidate_id: string;
  marketplace: string;
  priority_score: string | number;
  candidate_value: string;
};

const DEFAULT_DAILY_BUDGETS: Record<string, number> = {
  amazon: 10_000,
  temu: 8_000,
  aliexpress: 6_000,
  alibaba: 5_000,
  ebay: 6_000,
};

function nextDailyResetUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
}

export async function ensureDailyBudgets(): Promise<void> {
  const resetAt = nextDailyResetUtc();

  for (const [source, maxQueries] of Object.entries(DEFAULT_DAILY_BUDGETS)) {
    await db.execute(sql`
      INSERT INTO query_budgets (id, source, period, max_queries, used_queries, reset_at, created_at)
      VALUES (gen_random_uuid(), ${source}, 'daily', ${maxQueries}, 0, ${resetAt.toISOString()}, NOW())
      ON CONFLICT (source, period) DO NOTHING
    `);
  }
}

export async function resetDueBudgets(): Promise<number> {
  const nowIso = new Date().toISOString();
  const nextReset = nextDailyResetUtc().toISOString();

  const result = await db.execute(sql<{ id: string }>`
    UPDATE query_budgets
    SET used_queries = 0,
        reset_at = ${nextReset}
    WHERE period = 'daily'
      AND reset_at <= ${nowIso}
    RETURNING id
  `);

  return ((result as unknown as { rows?: Array<{ id: string }> }).rows ?? []).length;
}

async function ensureTasksFromCandidates(limitCandidates: number): Promise<number> {
  const candidatesResult = await db.execute(sql<{
    id: string;
    candidate_value: string;
    priority_score: string | number;
  }>`
    SELECT tc.id, tc.candidate_value, tc.priority_score
    FROM trend_candidates tc
    ORDER BY tc.priority_score DESC, tc.created_ts DESC
    LIMIT ${limitCandidates}
  `);

  const candidates =
    ((candidatesResult as unknown as {
      rows?: Array<{ id: string; candidate_value: string; priority_score: string | number }>;
    }).rows ?? []);

  let created = 0;

  for (const candidate of candidates) {
    for (const marketplace of Object.keys(DEFAULT_DAILY_BUDGETS)) {
      const insertResult = await db.execute(sql<{ id: string }>`
        INSERT INTO query_tasks (
          id,
          candidate_id,
          marketplace,
          priority_score,
          status,
          created_at
        )
        VALUES (
          gen_random_uuid(),
          ${candidate.id},
          ${marketplace},
          ${candidate.priority_score},
          'NEW',
          NOW()
        )
        ON CONFLICT (candidate_id, marketplace) DO NOTHING
        RETURNING id
      `);

      created += ((insertResult as unknown as { rows?: Array<{ id: string }> }).rows ?? []).length;
    }
  }

  return created;
}

async function hasRecentCacheHit(keyword: string, marketplace: string): Promise<boolean> {
  const r = await db.execute(sql<{ is_recent: boolean }>`
    SELECT EXISTS (
      SELECT 1
      FROM query_cache
      WHERE marketplace = ${marketplace}
        AND lower(trim(keyword)) = lower(trim(${keyword}))
        AND last_run_at >= NOW() - INTERVAL '24 hours'
    ) as is_recent
  `);

  const rows = ((r as unknown as { rows?: Array<{ is_recent: boolean }> }).rows ?? []);
  return Boolean(rows[0]?.is_recent);
}

async function getBudgets(): Promise<BudgetRow[]> {
  const r = await db.execute(sql<BudgetRow>`
    SELECT source, period, max_queries, used_queries, reset_at
    FROM query_budgets
    WHERE period = 'daily'
    ORDER BY source ASC
  `);
  return ((r as unknown as { rows?: BudgetRow[] }).rows ?? []);
}

async function pickTasksForSource(source: string, limit: number): Promise<QueryTaskPick[]> {
  const r = await db.execute(sql<QueryTaskPick>`
    SELECT qt.id, qt.candidate_id, qt.marketplace, qt.priority_score, tc.candidate_value
    FROM query_tasks qt
    JOIN trend_candidates tc ON tc.id = qt.candidate_id
    WHERE qt.status = 'NEW'
      AND qt.marketplace = ${source}
    ORDER BY qt.priority_score DESC, qt.created_at ASC
    LIMIT ${limit}
  `);

  return ((r as unknown as { rows?: QueryTaskPick[] }).rows ?? []);
}

export type AllocateQueryBudgetResult = {
  createdTasks: number;
  resetBudgets: number;
  queuedTasks: number;
  skippedByCache: number;
  sources: Array<{ source: string; remainingBefore: number; queued: number; skipped: number }>;
};

export async function allocateQueryBudget(input?: {
  candidateScanLimit?: number;
}): Promise<AllocateQueryBudgetResult> {
  await ensureDailyBudgets();
  const resetBudgets = await resetDueBudgets();
  const createdTasks = await ensureTasksFromCandidates(input?.candidateScanLimit ?? 300);

  const budgets = await getBudgets();

  let queuedTasks = 0;
  let skippedByCache = 0;
  const sourceStats: AllocateQueryBudgetResult["sources"] = [];

  for (const budget of budgets) {
    const remainingBefore = Math.max(0, budget.max_queries - budget.used_queries);
    if (remainingBefore <= 0) {
      sourceStats.push({ source: budget.source, remainingBefore, queued: 0, skipped: 0 });
      continue;
    }

    const tasks = await pickTasksForSource(budget.source, remainingBefore);
    let sourceQueued = 0;
    let sourceSkipped = 0;

    for (const task of tasks) {
      const keyword = String(task.candidate_value ?? "").trim();
      if (!keyword) continue;

      const isCached = await hasRecentCacheHit(keyword, task.marketplace);
      if (isCached) {
        await db.execute(sql`
          UPDATE query_tasks
          SET status = 'DONE',
              finished_at = NOW(),
              last_error = 'SKIPPED_RECENT_CACHE'
          WHERE id = ${task.id}
            AND status = 'NEW'
        `);
        skippedByCache += 1;
        sourceSkipped += 1;
        continue;
      }

      await enqueueProductDiscoverTask({
        candidateId: task.candidate_id,
        marketplace: task.marketplace,
        keyword,
        queryTaskId: task.id,
      });

      await db.execute(sql`
        UPDATE query_tasks
        SET status = 'QUEUED',
            queued_at = NOW()
        WHERE id = ${task.id}
          AND status = 'NEW'
      `);

      queuedTasks += 1;
      sourceQueued += 1;
    }

    sourceStats.push({ source: budget.source, remainingBefore, queued: sourceQueued, skipped: sourceSkipped });
  }

  return {
    createdTasks,
    resetBudgets,
    queuedTasks,
    skippedByCache,
    sources: sourceStats,
  };
}
