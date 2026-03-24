import pg from "pg";
import { loadRuntimeEnv, getRequiredDatabaseUrl } from "./lib/runtimeEnv.mjs";

loadRuntimeEnv();

const { Client } = pg;

async function main() {
  const listingId = String(process.argv[2] ?? "59f326e5-99dd-485f-a054-43aa353c42b0").trim();

  const client = new Client({
    connectionString: getRequiredDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });

  const { normalizeImageFromUrl, getNamedEbayImageHostingProvider } = await import(
    "@/lib/marketplaces/ebayImageHosting"
  );

  await client.connect();
  try {
    const listingRes = await client.query<{ payload: Record<string, unknown> }>(
      "SELECT payload FROM listings WHERE id = $1 LIMIT 1",
      [listingId]
    );
    const payload = listingRes.rows[0]?.payload ?? {};
    const urls = Array.isArray(payload.images) ? payload.images.map(String) : [];
    const provider = getNamedEbayImageHostingProvider("media_api_url");

    const backfillResults = [];
    for (const url of urls) {
      const result = await normalizeImageFromUrl(url, provider, undefined, { skipCache: true });
      backfillResults.push({
        sourceUrl: url,
        ok: result.ok,
        code: result.code,
        provider: result.providerUsed,
        epsUrl: result.epsUrl,
      });
    }

    const deleted = await client.query<{ source_url: string; provider: string }>(`
      DELETE FROM ebay_image_normalizations t
      WHERE t.provider = 'trading_upload_site_hosted_pictures'
        AND t.status = 'OK'
        AND EXISTS (
          SELECT 1
          FROM ebay_image_normalizations m
          WHERE m.source_url = t.source_url
            AND m.provider IN ('media_api_url', 'media_api_file')
            AND m.status = 'OK'
        )
      RETURNING t.source_url, t.provider
    `);

    const counts = await client.query<{
      provider: string;
      status: string;
      n: number;
    }>(
      "SELECT provider, status, count(*)::int AS n FROM ebay_image_normalizations GROUP BY provider, status ORDER BY provider, status"
    );

    console.log(
      JSON.stringify(
        {
          listingId,
          imageCount: urls.length,
          backfillOk: backfillResults.filter((row) => row.ok).length,
          backfillFailed: backfillResults.filter((row) => !row.ok).length,
          deletedTradingRows: deleted.rowCount ?? 0,
          sample: backfillResults.slice(0, 5),
          counts: counts.rows,
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
