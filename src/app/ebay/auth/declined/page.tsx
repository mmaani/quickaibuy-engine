import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "eBay Authorization Declined",
  description: "QuickAIBuy eBay authorization declined page.",
};

export default function EbayAuthDeclinedPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">Authorization Declined</h1>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        eBay authorization was declined, so QuickAIBuy cannot complete live setup for this seller
        account yet.
      </p>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        You can retry the eBay authorization flow from the QuickAIBuy admin setup when ready.
      </p>
    </main>
  );
}
