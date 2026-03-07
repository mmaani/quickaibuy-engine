import { db } from "@/lib/db";
import { productsRaw } from "@/lib/db/schema";
import { desc, eq, isNotNull, sql } from "drizzle-orm";

export type InsertRawProductInput = {
  supplierKey: string;
  supplierProductId: string;
  sourceUrl?: string | null;
  title?: string | null;
  images?: unknown[] | null;
  variants?: unknown[] | null;
  currency?: string | null;
  priceMin?: string | number | null;
  priceMax?: string | number | null;
  availabilityStatus?: string | null;
  shippingEstimates?: unknown;
  rawPayload: Record<string, unknown>;
  snapshotTs?: Date;
};

export async function insertProductsRaw(rows: InsertRawProductInput[]): Promise<number> {
  if (!rows.length) return 0;

  await db.insert(productsRaw).values(
    rows.map((row) => ({
      supplierKey: row.supplierKey,
      supplierProductId: row.supplierProductId,
      sourceUrl: row.sourceUrl ?? null,
      title: row.title ?? null,
      images: row.images ?? null,
      variants: row.variants ?? null,
      currency: row.currency ?? null,
      priceMin: row.priceMin != null ? String(row.priceMin) : null,
      priceMax: row.priceMax != null ? String(row.priceMax) : null,
      availabilityStatus: row.availabilityStatus ?? null,
      shippingEstimates: row.shippingEstimates ?? null,
      rawPayload: row.rawPayload,
      snapshotTs: row.snapshotTs ?? new Date(),
    }))
  );

  return rows.length;
}

export async function getProductsRawForMarketplaceScan(limit = 100) {
  return db
    .select({
      id: productsRaw.id,
      supplierKey: productsRaw.supplierKey,
      supplierProductId: productsRaw.supplierProductId,
      title: productsRaw.title,
      currency: productsRaw.currency,
      rawPayload: productsRaw.rawPayload,
      sourceUrl: productsRaw.sourceUrl,
    })
    .from(productsRaw)
    .where(isNotNull(productsRaw.title))
    .orderBy(desc(productsRaw.snapshotTs))
    .limit(limit);
}

export async function getProductRawById(id: string) {
  const rows = await db
    .select({
      id: productsRaw.id,
      supplierKey: productsRaw.supplierKey,
      supplierProductId: productsRaw.supplierProductId,
      title: productsRaw.title,
      currency: productsRaw.currency,
      rawPayload: productsRaw.rawPayload,
      sourceUrl: productsRaw.sourceUrl,
    })
    .from(productsRaw)
    .where(eq(productsRaw.id, id))
    .limit(1);

  return rows[0] ?? null;
}

export async function countProductsRawWithTitle() {
  const rows = await db
    .select({
      count: sql<number>`count(*)::int`,
    })
    .from(productsRaw)
    .where(isNotNull(productsRaw.title));

  return rows[0]?.count ?? 0;
}
