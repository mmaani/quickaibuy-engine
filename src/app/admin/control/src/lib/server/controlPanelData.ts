type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

async function fetchJsonWithTimeout(url: string, timeoutMs = 4000): Promise<{
  ok: boolean;
  status: number | null;
  data: JsonValue | null;
  error: string | null;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "x-internal-control-panel": "1",
      },
    });

    const text = await res.text();
    let data: JsonValue | null = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      status: null,
      data: null,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.startsWith("http")
      ? process.env.VERCEL_PROJECT_PRODUCTION_URL
      : process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000"
  );
}

export async function getControlPanelData() {
  const baseUrl = getBaseUrl();

  const [health, queues, workerRuns] = await Promise.allSettled([
    fetchJsonWithTimeout(`${baseUrl}/api/health`, 4000),
    fetchJsonWithTimeout(`${baseUrl}/api/ops/queues`, 4000),
    fetchJsonWithTimeout(`${baseUrl}/api/ops/worker-runs`, 4000),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    health: health.status === "fulfilled"
      ? health.value
      : { ok: false, status: null, data: null, error: health.reason instanceof Error ? health.reason.message : String(health.reason) },

    queues: queues.status === "fulfilled"
      ? queues.value
      : { ok: false, status: null, data: null, error: queues.reason instanceof Error ? queues.reason.message : String(queues.reason) },

    workerRuns: workerRuns.status === "fulfilled"
      ? workerRuns.value
      : { ok: false, status: null, data: null, error: workerRuns.reason instanceof Error ? workerRuns.reason.message : String(workerRuns.reason) },
  };
}
