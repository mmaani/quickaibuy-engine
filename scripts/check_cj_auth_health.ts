import { getCjAuthSnapshot } from "@/lib/suppliers/cj";

const snapshot = getCjAuthSnapshot();
console.log(
  JSON.stringify(
    {
      ok: snapshot.hasApiKey,
      hasApiKey: snapshot.hasApiKey,
      hasPlatformToken: snapshot.hasPlatformToken,
      tokenFresh: snapshot.tokenFresh,
      accessTokenExpiresAtMs: snapshot.accessTokenExpiresAtMs,
      refreshTokenExpiresAtMs: snapshot.refreshTokenExpiresAtMs,
      tokenSource: snapshot.tokenSource,
    },
    null,
    2
  )
);

if (!snapshot.hasApiKey) process.exitCode = 1;
