import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://quickaibuy.com"),
  title: {
    default: "QuickAIBuy | AI-Powered Product Discovery Intelligence",
    template: "%s | QuickAIBuy",
  },
  description:
    "QuickAIBuy is an AI-powered product discovery and arbitrage intelligence platform for supplier sourcing, marketplace pricing, and trend-led opportunity detection.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
