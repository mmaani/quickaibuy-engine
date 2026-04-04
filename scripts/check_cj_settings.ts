import { formatCjErrorForOperator, getCjSettingsSummary, getCjShops } from "@/lib/suppliers/cj";

async function main() {
  const [settings, shops] = await Promise.all([getCjSettingsSummary(), getCjShops().catch(() => [])]);
  console.log(
    JSON.stringify(
      {
        ok: Boolean(settings),
        settings,
        shopCount: shops.length,
        shops,
      },
      null,
      2
    )
  );
  if (!settings) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
