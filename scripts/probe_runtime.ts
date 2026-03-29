import { getRuntimeDiagnostics } from "./lib/runtimeDiagnostics.mjs";
import { pool } from "../src/lib/db";
import { getRedis } from "../src/lib/redis";

async function main() {
  const db = await pool.query("select 1 as ok");
  const redis = getRedis();
  const pong = await redis.ping();
  const diagnostics = await getRuntimeDiagnostics({ includeConnectivity: false });

  console.log({
    ok: true,
    db: db.rows[0]?.ok === 1 ? "ok" : "unknown",
    redis: pong,
    runtime: diagnostics,
  });
}

main()
  .catch((err) => {
    console.error("Runtime probe failed");
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
    try {
      await getRedis().quit();
    } catch {}
  });
