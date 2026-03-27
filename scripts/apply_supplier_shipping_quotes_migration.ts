import "dotenv/config";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pool } from "@/lib/db";

async function main() {
  const filePath = resolve(process.cwd(), "migrations/20260327_add_supplier_shipping_quotes.sql");
  const sql = readFileSync(filePath, "utf8");
  await pool.query(sql);
  console.log(JSON.stringify({ ok: true, filePath }, null, 2));
}

main()
  .catch((error) => {
    console.error("apply_supplier_shipping_quotes_migration failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
