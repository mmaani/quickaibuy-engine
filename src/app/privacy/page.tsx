import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "QuickAIBuy privacy policy for eBay authorization and marketplace operations.",
};

export default function PrivacyPage() {
  return (
    <main className="bg-app min-h-screen px-6 py-16 text-white">
      <div className="glass-panel mx-auto max-w-3xl rounded-3xl p-8">
        <h1 className="text-3xl font-semibold tracking-tight">Privacy Policy</h1>
        <p className="mt-4 text-sm text-white/60">Last updated: March 10, 2026</p>

        <section className="mt-8 space-y-4 text-sm leading-6 text-white/80">
          <p>
            QuickAIBuy uses marketplace authorization data to operate listing workflows and guarded
            publish actions on behalf of authorized seller accounts.
          </p>
          <p>
            For eBay user-token flows, we store authorization credentials (including refresh tokens)
            securely and use them only to mint short-lived access tokens at runtime. Access tokens are
            not persisted to repository files.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Data We Use</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-sm leading-6 text-white/80">
            <li>Seller account authorization and consent state needed for eBay API access.</li>
            <li>Inventory and account configuration needed for listing setup (for example location and policy IDs).</li>
            <li>Listing preparation and publish-related data such as titles, prices, and item metadata.</li>
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-semibold">Usage Boundaries</h2>
          <ul className="mt-4 list-disc space-y-2 pl-6 text-sm leading-6 text-white/80">
            <li>QuickAIBuy separates seller base configuration from supplier ship-from country data.</li>
            <li>Supplier ship-from country is used for listing origin correctness and validation.</li>
            <li>Guarded live publish blocks when required configuration or ship-from data is missing.</li>
          </ul>
        </section>

        <section className="mt-10 text-sm leading-6 text-white/80">
          <h2 className="text-xl font-semibold">Contact</h2>
          <p className="mt-4">
            For privacy or account-data questions, contact the QuickAIBuy support team at{" "}
            <a className="font-semibold text-[#9cf6d7] underline" href="mailto:support@quickaibuy.com">
              support@quickaibuy.com
            </a>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
