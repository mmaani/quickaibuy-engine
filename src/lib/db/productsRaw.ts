import { db } from "@/lib/db";
import { productsRaw } from "@/db/schema";

export type InsertRawProductInput = {
  source: string;
  sourceUrl: string;
  externalId?: string | null;
  raw: Record<string, unknown>;
  fetchedAt?: Date;
};

export async function insertProductsRaw(rows: InsertRawProductInput[]): Promise<number> {
  if (!rows.length) return 0;

  await db.insert(productsRaw).values(
    rows.map((row) => ({
      source: row.source,
      sourceUrl: row.sourceUrl,
      externalId: row.externalId ?? null,
      raw: row.raw,
      fetchedAt: row.fetchedAt ?? new Date(),
    }))
  );

  return rows.length;
}
