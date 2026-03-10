import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "eBay Authorization Declined",
  description: "QuickAIBuy eBay authorization declined page.",
};

export default function EbayAuthDeclinedPage() {
  return (
    <main className="bg-app min-h-screen px-6 py-20 text-white">
      <div className="glass-panel mx-auto max-w-2xl rounded-3xl p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Authorization Declined</h1>
        <p className="mt-4 text-sm leading-6 text-white/80">
          eBay authorization was declined, so QuickAIBuy cannot complete live setup for this seller
          account yet.
        </p>
        <p className="mt-4 text-sm leading-6 text-white/75">
          You can retry the eBay authorization flow from the QuickAIBuy admin setup when ready.
        </p>
      </div>
    </main>
  );
}
