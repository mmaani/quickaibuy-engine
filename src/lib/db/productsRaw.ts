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

export async function insertProductRawReturningId(row: InsertRawProductInput): Promise<string> {
  const inserted = await db
    .insert(productsRaw)
    .values({
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
    })
    .returning({ id: productsRaw.id });

  return String(inserted[0]?.id ?? "");
}

export async function updateProductRawById(
  id: string,
  row: InsertRawProductInput
): Promise<string> {
  const updated = await db
    .update(productsRaw)
    .set({
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
    })
    .where(eq(productsRaw.id, id))
    .returning({ id: productsRaw.id });

  return String(updated[0]?.id ?? "");
}

export async function getLatestProductRawBySupplierProduct(input: {
  supplierKey: string;
  supplierProductId: string;
}) {
  const rows = await db
    .select({
      id: productsRaw.id,
      supplierKey: productsRaw.supplierKey,
      supplierProductId: productsRaw.supplierProductId,
      sourceUrl: productsRaw.sourceUrl,
      title: productsRaw.title,
      images: productsRaw.images,
      variants: productsRaw.variants,
      currency: productsRaw.currency,
      priceMin: productsRaw.priceMin,
      priceMax: productsRaw.priceMax,
      availabilityStatus: productsRaw.availabilityStatus,
      shippingEstimates: productsRaw.shippingEstimates,
      rawPayload: productsRaw.rawPayload,
      snapshotTs: productsRaw.snapshotTs,
    })
    .from(productsRaw)
    .where(
      sql`LOWER(${productsRaw.supplierKey}) = ${String(input.supplierKey).trim().toLowerCase()}
        AND ${productsRaw.supplierProductId} = ${String(input.supplierProductId).trim()}`
    )
    .orderBy(desc(productsRaw.snapshotTs), desc(productsRaw.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function getProductsRawForMarketplaceScan(limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));
  const result = await db.execute<{
    id: string;
    supplierKey: string;
    supplierProductId: string;
    title: string | null;
    currency: string | null;
    rawPayload: unknown;
    sourceUrl: string | null;
  }>(sql.raw(`
    with ranked_products as (
      select
        id::text as id,
        supplier_key as "supplierKey",
        supplier_product_id as "supplierProductId",
        title,
        currency,
        raw_payload as "rawPayload",
        source_url as "sourceUrl",
        snapshot_ts,
        row_number() over (
          partition by lower(supplier_key), supplier_product_id
          order by snapshot_ts desc nulls last, id desc
        ) as rn
      from products_raw
      where title is not null
    )
    select id, "supplierKey", "supplierProductId", title, currency, "rawPayload", "sourceUrl"
    from ranked_products
    where rn = 1
    order by snapshot_ts asc nulls first, id asc
    limit ${safeLimit}
  `));

  return result.rows ?? [];
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

type ProductsRawOrderColumn = "snapshot_ts" | "created_at" | "id";

let productsRawOrderColumnCache: ProductsRawOrderColumn | null = null;

async function resolveProductsRawOrderColumn(): Promise<ProductsRawOrderColumn> {
  if (productsRawOrderColumnCache) return productsRawOrderColumnCache;

  const result = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products_raw'
      AND column_name IN ('snapshot_ts', 'created_at')
  `);

  const columns = new Set((result.rows ?? []).map((row) => String(row.column_name || "")));
  if (columns.has("snapshot_ts")) {
    productsRawOrderColumnCache = "snapshot_ts";
    return productsRawOrderColumnCache;
  }
  if (columns.has("created_at")) {
    productsRawOrderColumnCache = "created_at";
    return productsRawOrderColumnCache;
  }

  productsRawOrderColumnCache = "id";
  return productsRawOrderColumnCache;
}

export async function getProductsRawLatestOrderBySql(alias: string): Promise<ReturnType<typeof sql.raw>> {
  const orderColumn = await resolveProductsRawOrderColumn();
  if (orderColumn === "id") {
    return sql.raw(`${alias}.id DESC`);
  }
  return sql.raw(`${alias}.${orderColumn} DESC, ${alias}.id DESC`);
}

export async function getProductsRawTimestampExprSql(alias: string): Promise<ReturnType<typeof sql.raw>> {
  const orderColumn = await resolveProductsRawOrderColumn();
  if (orderColumn === "snapshot_ts" || orderColumn === "created_at") {
    return sql.raw(`${alias}.${orderColumn}`);
  }
  return sql.raw(`NULL::timestamp`);
}
