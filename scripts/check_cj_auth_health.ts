import { formatCjErrorForOperator, getCjAuthSnapshot, getValidCjAccessToken } from "@/lib/suppliers/cj";

async function main() {
  const token = await getValidCjAccessToken();
  const snapshot = getCjAuthSnapshot();
  console.log(
    JSON.stringify(
      {
        ok: snapshot.hasApiKey && Boolean(token),
        hasApiKey: snapshot.hasApiKey,
        hasPlatformToken: snapshot.hasPlatformToken,
        tokenFresh: snapshot.tokenFresh,
        tokenAvailable: Boolean(token),
        accessTokenExpiresAtMs: snapshot.accessTokenExpiresAtMs,
        refreshTokenExpiresAtMs: snapshot.refreshTokenExpiresAtMs,
        tokenSource: snapshot.tokenSource,
      },
      null,
      2
    )
  );

  if (!snapshot.hasApiKey || !token) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: formatCjErrorForOperator(error) }, null, 2));
  process.exitCode = 1;
});
