import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "eBay Authorization Accepted",
  description: "QuickAIBuy eBay authorization success page.",
};

export default function EbayAuthAcceptedPage() {
  return (
    <main className="bg-app min-h-screen px-6 py-20 text-white">
      <div className="glass-panel mx-auto max-w-2xl rounded-3xl p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Authorization Accepted</h1>
        <p className="mt-4 text-sm leading-6 text-white/80">
          eBay authorization was accepted. QuickAIBuy can continue account setup and guarded publish
          readiness checks.
        </p>
        <p className="mt-4 text-sm leading-6 text-white/75">
          Next step: return to your QuickAIBuy admin workflow and confirm live-publish prerequisites
          (merchant location, policies, category, and supplier ship-from country validation).
        </p>
      </div>
    </main>
  );
}
