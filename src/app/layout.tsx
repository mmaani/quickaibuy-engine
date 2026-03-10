import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: "../../public/fonts/inter.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

const manrope = localFont({
  src: "../../public/fonts/manrope.woff2",
  variable: "--font-manrope",
  display: "swap",
  weight: "200 800",
});

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
      <body className={`${inter.variable} ${manrope.variable}`}>{children}</body>
    </html>
  );
}
