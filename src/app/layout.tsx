import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "../../public/fonts/inter-latin-100-normal.woff2", weight: "100", style: "normal" },
    { path: "../../public/fonts/inter-latin-200-normal.woff2", weight: "200", style: "normal" },
    { path: "../../public/fonts/inter-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/inter-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/inter-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/inter-latin-800-normal.woff2", weight: "800", style: "normal" },
    { path: "../../public/fonts/inter-latin-900-normal.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const manrope = localFont({
  src: [
    { path: "../../public/fonts/manrope-latin-200-normal.woff2", weight: "200", style: "normal" },
    { path: "../../public/fonts/manrope-latin-300-normal.woff2", weight: "300", style: "normal" },
    { path: "../../public/fonts/manrope-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/manrope-latin-500-normal.woff2", weight: "500", style: "normal" },
    { path: "../../public/fonts/manrope-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "../../public/fonts/manrope-latin-700-normal.woff2", weight: "700", style: "normal" },
    { path: "../../public/fonts/manrope-latin-800-normal.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-manrope",
  display: "swap",
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
