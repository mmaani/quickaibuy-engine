import { getControlPanelData as getRawControlPanelData } from "@/lib/control/getControlPanelData";

export type PanelSection<T = Record<string, unknown>> = {
  ok: boolean;
  status: number | null;
  error: string | null;
  data: T | null;
};

export type SafeControlPanelData = {
  generatedAt: string;
  health: PanelSection;
  queues: PanelSection;
  workerRuns: PanelSection;
};

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown error";
}

async function readHealth(): Promise<PanelSection> {
  try {
    const raw = await getRawControlPanelData();
    const queueCounts = raw.health.queue.counts ?? {};

    const data = {
      db: raw.health.db,
      redis: raw.health.redis,
      queue: {
        status: raw.health.queue.status,
        detail: raw.health.queue.detail ?? null,
        counts: queueCounts,
      },
    };

    const ok = raw.health.db.status === "ok" && raw.health.redis.status === "ok";

    return {
      ok,
      status: ok ? 200 : 503,
      error: null,
      data,
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: toErrorMessage(error),
      data: null,
    };
  }
}

async function readQueues(): Promise<PanelSection> {
  try {
    const raw = await getRawControlPanelData();
    const queue = raw.health.queue;

    return {
      ok: queue.status === "ok",
      status: queue.status === "ok" ? 200 : 503,
      error: queue.status === "ok" ? null : (queue.detail ?? "Queue degraded"),
      data: {
        status: queue.status,
        detail: queue.detail ?? null,
        counts: queue.counts ?? {},
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: toErrorMessage(error),
      data: null,
    };
  }
}

async function readWorkerRuns(): Promise<PanelSection> {
  try {
    const raw = await getRawControlPanelData();

    return {
      ok: true,
      status: 200,
      error: null,
      data: {
        recentWorkerRuns: raw.workerQueueHealth.recentWorkerRuns,
        recentWorkerFailures: raw.workerQueueHealth.recentWorkerFailures,
        recentJobs: raw.workerQueueHealth.recentJobs,
        recentJobFailures: raw.workerQueueHealth.recentJobFailures,
        recentAuditEvents: raw.workerQueueHealth.recentAuditEvents,
        recentWorkerActivityTs: raw.workerQueueHealth.recentWorkerActivityTs,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: 500,
      error: toErrorMessage(error),
      data: null,
    };
  }
}

export async function getControlPanelData(): Promise<SafeControlPanelData> {
  const [health, queues, workerRuns] = await Promise.all([
    readHealth(),
    readQueues(),
    readWorkerRuns(),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    health,
    queues,
    workerRuns,
  };
}
