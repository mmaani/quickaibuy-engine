type PanelResult = {
  ok: boolean;
  status: number | null;
  data: unknown;
  error: string | null;
};

function getBaseUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) return appUrl;

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (!vercelUrl) return "http://localhost:3000";

  return vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
}

async function fetchJsonWithTimeout(
  url: string,
  authHeader: string | null,
  timeoutMs = 4000
): Promise<PanelResult> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: authHeader ? { authorization: authHeader } : undefined,
    });

    const data = await res.json().catch(() => null);

    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : `HTTP ${res.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      data: null,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(t);
  }
}

export async function getControlPanelData(authHeader: string | null) {
  const baseUrl = getBaseUrl();

  const [health, queues, workerRuns, errors] = await Promise.allSettled([
    fetchJsonWithTimeout(`${baseUrl}/api/health`, authHeader),
    fetchJsonWithTimeout(`${baseUrl}/api/ops/queues`, authHeader),
    fetchJsonWithTimeout(`${baseUrl}/api/ops/worker-runs`, authHeader),
    fetchJsonWithTimeout(`${baseUrl}/api/ops/errors`, authHeader),
  ]);

  const normalize = (result: PromiseSettledResult<PanelResult>): PanelResult => {
    if (result.status === "fulfilled") return result.value;
    return {
      ok: false,
      status: null,
      data: null,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    };
  };

  return {
    generatedAt: new Date().toISOString(),
    health: normalize(health),
    queues: normalize(queues),
    workerRuns: normalize(workerRuns),
    errors: normalize(errors),
  };
}
