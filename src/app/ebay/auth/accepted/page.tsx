import type { Metadata } from "next";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";

export const metadata: Metadata = {
  title: "eBay Authorization Accepted",
  description: "QuickAIBuy eBay authorization success page.",
};

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(searchParams: SearchParams, key: string): string | null {
  const value = searchParams[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function exchangeAuthorizationCode(code: string) {
  loadRuntimeEnv();

  const clientId = String(process.env.EBAY_CLIENT_ID ?? "").trim();
  const clientSecret = String(process.env.EBAY_CLIENT_SECRET ?? "").trim();
  const redirectUri = "Mohammad_Maani-Mohammad-QuickA-qehtnbwbq";

  if (!clientId || !clientSecret) {
    return {
      ok: false as const,
      error: "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in runtime env.",
    };
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
    cache: "no-store",
  });

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    return {
      ok: false as const,
      error:
        typeof body.error_description === "string"
          ? body.error_description
          : typeof body.error === "string"
            ? body.error
            : `eBay token exchange failed with status ${response.status}`,
      details: body,
    };
  }

  return {
    ok: true as const,
    accessToken: String(body.access_token ?? ""),
    refreshToken: String(body.refresh_token ?? ""),
    expiresIn: Number(body.expires_in ?? 0),
    refreshTokenExpiresIn: Number(body.refresh_token_expires_in ?? 0),
  };
}

export default async function EbayAuthAcceptedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await searchParams;
  const code = getParam(resolvedSearchParams, "code");
  const expiresIn = getParam(resolvedSearchParams, "expires_in");

  const exchange = code ? await exchangeAuthorizationCode(code) : null;

  return (
    <main className="bg-app min-h-screen px-6 py-20 text-white">
      <div className="glass-panel mx-auto max-w-3xl rounded-3xl p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Authorization Accepted</h1>
        <p className="mt-4 text-sm leading-6 text-white/80">
          eBay authorization was accepted. This page now inspects the returned OAuth query and exchanges the
          authorization code server-side when present.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/80">
          <div>Authorization code present: {code ? "yes" : "no"}</div>
          <div>Callback expires_in: {expiresIn ?? "unknown"}</div>
        </div>

        {!code ? (
          <div className="mt-6 rounded-2xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm leading-6 text-amber-50">
            No <code>code</code> query parameter was visible to the callback page. Copy the full address bar URL from this
            page and inspect whether the OAuth redirect is stripping query params before it reaches Next.js.
          </div>
        ) : null}

        {exchange && !exchange.ok ? (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm leading-6 text-rose-50">
            <div className="font-semibold">Token exchange failed</div>
            <div className="mt-2">{exchange.error}</div>
            {exchange.details ? (
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-xs text-rose-50/90">
                {JSON.stringify(exchange.details, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}

        {exchange && exchange.ok ? (
          <div className="mt-6 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-50">
            <div className="font-semibold">Token exchange succeeded</div>
            <div className="mt-2">Access token length: {exchange.accessToken.length}</div>
            <div>Refresh token length: {exchange.refreshToken.length}</div>
            <div>Access token expires in: {exchange.expiresIn}s</div>
            <div>Refresh token expires in: {exchange.refreshTokenExpiresIn || "unknown"}s</div>
            <div className="mt-4 font-semibold">New refresh token</div>
            <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-black/25 p-3 text-xs text-emerald-50/95">
              {exchange.refreshToken}
            </pre>
            <p className="mt-4 text-sm leading-6 text-emerald-50/90">
              Replace <code>EBAY_REFRESH_TOKEN</code> in the runtime secret store with this value, then restart the jobs
              worker and re-run the order-sync verification.
            </p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
