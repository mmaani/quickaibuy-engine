import fs from "fs";

function loadEnvFile(file: string) {
  if (!fs.existsSync(file)) return false;
  const text = fs.readFileSync(file, "utf8");

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();

    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }

    if (!(key in process.env)) process.env[key] = val;
  }

  return true;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

async function resolveTrendSignalId(input?: string): Promise<string> {
  const provided = String(input ?? "").trim();
  if (provided) return provided;

  const { pool } = await import("../src/lib/db");
  const result = await pool.query<{ id: string }>(
    `
      select id::text as id
      from trend_signals
      order by captured_ts desc nulls last, id desc
      limit 1
    `
  );

  const latest = String(result.rows[0]?.id ?? "").trim();
  if (!latest) {
    throw new Error(
      "No trendSignalId provided and no rows found in trend_signals. Pass an id explicitly."
    );
  }

  return latest;
}

async function main() {
  const trendSignalId = await resolveTrendSignalId(process.argv[2]);
  const { enqueueTrendExpand, jobsQueue } = await import("../src/lib/jobs/enqueueTrendExpand");
  const job = await enqueueTrendExpand(trendSignalId);

  console.log({
    ok: true,
    jobId: job.id,
    trendSignalId,
  });

  await jobsQueue.close();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
