import fs from "fs";
import { Client } from "pg";

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
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
}

function ensureSslMode(url) {
  if (!url) return url;
  if (/sslmode=/i.test(url)) return url;
  return url.includes("?") ? `${url}&sslmode=require` : `${url}?sslmode=require`;
}

loadEnvFile(".env.local");
loadEnvFile(".env.development.local");
loadEnvFile(".env");
loadEnvFile(".env.development");

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const client = new Client({
  connectionString: ensureSslMode(connectionString),
  ssl: { rejectUnauthorized: false },
});

async function scalar(query) {
  const r = await client.query(query);
  return r.rows[0]?.n ?? 0;
}

try {
  await client.connect();

  const stats = {
    trend_signals: await scalar(`select count(*)::int as n from trend_signals`),
    trend_candidates: await scalar(`select count(*)::int as n from trend_candidates`),
    products_raw: await scalar(`select count(*)::int as n from products_raw`),
    marketplace_prices: await scalar(`select count(*)::int as n from marketplace_prices`),
    matches: await scalar(`select count(*)::int as n from matches`),
    active_matches: await scalar(`select count(*)::int as n from matches where status = 'ACTIVE'`),
  };

  console.table([stats]);

  const confidenceBands = await client.query(`
    select
      case
        when confidence >= 0.90 then 'high'
        when confidence >= 0.75 then 'medium'
        else 'low'
      end as band,
      count(*)::int as count
    from matches
    group by 1
    order by 1
  `);

  console.log("\nConfidence bands:");
  console.table(confidenceBands.rows);

  const recentAudit = await client.query(`
    select event_ts, actor_type, actor_id, entity_type, entity_id, event_type
    from audit_log
    order by event_ts desc
    limit 20
  `);

  console.log("\nRecent audit events:");
  console.table(recentAudit.rows);
} finally {
  await client.end();
}
