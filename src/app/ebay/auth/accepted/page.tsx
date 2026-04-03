import type { Metadata } from "next";
import { unstable_noStore as noStore } from "next/cache";
import { handleEbayOAuthCallback } from "@/lib/marketplaces/ebayOAuthCallback";

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

export default async function EbayAuthAcceptedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  noStore();

  const resolvedSearchParams = await searchParams;
  const code = getParam(resolvedSearchParams, "code");
  const expiresIn = getParam(resolvedSearchParams, "expires_in");
  const result = await handleEbayOAuthCallback(code);

  return (
    <main className="bg-app min-h-screen px-6 py-20 text-white">
      <div className="glass-panel mx-auto max-w-3xl rounded-3xl p-8">
        <h1 className="text-3xl font-semibold tracking-tight">{result.title}</h1>
        <p className="mt-4 text-sm leading-6 text-white/80">
          This callback runs entirely on the server: it reads the eBay query string, exchanges the authorization
          code against the production token endpoint, and stores the resulting refresh token without exposing it
          in client-side code.
        </p>

        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-sm text-white/80">
          <div>Authorization code present: {code ? "yes" : "no"}</div>
          <div>Callback expires_in: {expiresIn ?? "unknown"}</div>
          <div>RuName: Mohammad_Maani-Mohammad-QuickA-qehtnbwbq</div>
          <div>eBay endpoint: production</div>
        </div>

        {!result.ok ? (
          <div className="mt-6 rounded-2xl border border-rose-300/30 bg-rose-400/10 p-4 text-sm leading-6 text-rose-50">
            <div className="font-semibold">Authorization flow failed</div>
            <div className="mt-2">{result.detail}</div>
            <div className="mt-3">Failure code: {result.code}</div>
            {result.exchangeErrorCode ? <div>eBay error: {result.exchangeErrorCode}</div> : null}
            <p className="mt-4 text-sm leading-6 text-rose-50/90">{result.operatorAction}</p>
          </div>
        ) : null}

        {result.ok ? (
          <div className="mt-6 rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-4 text-sm leading-6 text-emerald-50">
            <div className="font-semibold">Authorization flow succeeded</div>
            <div className="mt-2">{result.detail}</div>
            <div>Access token expires in: {result.accessTokenExpiresIn}s</div>
            <div>Refresh token expires in: {result.refreshTokenExpiresIn ?? "unknown"}s</div>
            <div>Persisted secret: EBAY_REFRESH_TOKEN</div>
            <div>Persisted target: {result.persistedTarget}</div>
            <p className="mt-4 text-sm leading-6 text-emerald-50/90">{result.operatorAction}</p>
          </div>
        ) : null}
      </div>
    </main>
  );
}
