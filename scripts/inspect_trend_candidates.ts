import "dotenv/config";
import { db } from "../src/lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const cols = await db.execute(sql`
    select
      column_name,
      data_type,
      is_nullable
    from information_schema.columns
    where table_name = 'trend_candidates'
    order by ordinal_position
  `);

  console.log("=== trend_candidates columns ===");
  console.dir(cols.rows, { depth: null });

  const rows = await db.execute(sql`
    select *
    from trend_candidates
    limit 10
  `);

  console.log("=== trend_candidates sample rows ===");
  console.dir(rows.rows, { depth: null });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
