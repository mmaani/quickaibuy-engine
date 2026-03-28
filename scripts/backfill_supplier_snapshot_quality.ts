import pg from "pg";
import { resolveSupplierQualityPayload, normalizeSupplierSnapshotQuality, normalizeSupplierTelemetry } from "@/lib/products/supplierQuality";
import { assertMutationAllowed } from "./lib/mutationGuard.mjs";
import { loadRuntimeEnv } from "./lib/runtimeEnv.mjs";

const { Client } = pg;

type ProductsRawRow = {
  id: string;
  supplier_key: string;
  supplier_product_id: string;
  title: string | null;
  source_url: string | null;
  price_min: string | null;
  price_max: string | null;
  availability_status: string | null;
  images: unknown;
  shipping_estimates: unknown;
  raw_payload: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseIntArg(name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  if (!match) return fallback;
  const parsed = Number(match.slice(prefix.length));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

async function main() {
  loadRuntimeEnv();
  assertMutationAllowed("backfill_supplier_snapshot_quality.ts");
  const dryRun = process.argv.includes("--dry-run");
  const batchSize = parseIntArg("batch-size", 200);
  const maxRows = parseIntArg("limit", 100000);

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  let offset = 0;
  let scanned = 0;
  let updated = 0;
  let snapshotQualityAdded = 0;
  let telemetryAdded = 0;

  while (scanned < maxRows) {
    const size = Math.min(batchSize, maxRows - scanned);
    const result = await client.query<ProductsRawRow>(
      `
        SELECT
          id,
          supplier_key,
          supplier_product_id,
          title,
          source_url,
          price_min::text,
          price_max::text,
          availability_status,
          images,
          shipping_estimates,
          raw_payload
        FROM products_raw
        ORDER BY snapshot_ts ASC NULLS LAST, id ASC
        LIMIT $1
        OFFSET $2
      `,
      [size, offset]
    );

    if (!result.rows.length) break;

    for (const row of result.rows) {
      scanned += 1;
      const rawPayload = asObject(row.raw_payload);
      if (!rawPayload) continue;

      const currentQuality = normalizeSupplierSnapshotQuality(rawPayload.snapshotQuality);
      const currentTelemetry = normalizeSupplierTelemetry(rawPayload);
      const resolved = resolveSupplierQualityPayload({
        rawPayload,
        availabilitySignal: row.availability_status,
        price: row.price_min ?? row.price_max,
        title: row.title,
        sourceUrl: row.source_url,
        images: row.images,
        shippingEstimates: row.shipping_estimates,
      });

      if (!resolved.changed) continue;

      const nextPayload = {
        ...rawPayload,
        snapshotQuality: resolved.snapshotQuality,
        telemetrySignals: resolved.telemetrySignals,
        telemetry: resolved.telemetry,
      };

      if (!currentQuality && resolved.snapshotQuality) {
        snapshotQualityAdded += 1;
      } else if (currentQuality !== resolved.snapshotQuality) {
        snapshotQualityAdded += 1;
      }

      const currentSignals = currentTelemetry.signals.join(",");
      const nextSignals = resolved.telemetrySignals.join(",");
      if (currentSignals !== nextSignals) {
        telemetryAdded += 1;
      }

      updated += 1;

      if (!dryRun) {
        await client.query(
          `
            UPDATE products_raw
            SET raw_payload = $2::jsonb
            WHERE id = $1
          `,
          [row.id, JSON.stringify(nextPayload)]
        );
      }
    }

    offset += result.rows.length;
    if (result.rows.length < size) break;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned,
        updated,
        snapshotQualityAdded,
        telemetryAdded,
      },
      null,
      2
    )
  );

  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
