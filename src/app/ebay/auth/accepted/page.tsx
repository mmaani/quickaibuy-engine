import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "eBay Authorization Accepted",
  description: "QuickAIBuy eBay authorization success page.",
};

export default function EbayAuthAcceptedPage() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-20 text-slate-900">
      <h1 className="text-3xl font-semibold tracking-tight">Authorization Accepted</h1>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        eBay authorization was accepted. QuickAIBuy can continue account setup and guarded publish
        readiness checks.
      </p>
      <p className="mt-4 text-sm leading-6 text-slate-700">
        Next step: return to your QuickAIBuy admin workflow and confirm live-publish prerequisites
        (merchant location, policies, category, and supplier ship-from country validation).
      </p>
    </main>
  );
}
