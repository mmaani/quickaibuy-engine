import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
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
  keywords: [
    "AI product discovery",
    "product discovery intelligence",
    "supplier sourcing software",
    "marketplace monitoring",
    "Amazon product research",
    "eBay product research",
    "arbitrage intelligence",
    "trend product discovery",
    "ecommerce product intelligence",
  ],
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    title: "QuickAIBuy | AI-Powered Product Discovery Intelligence",
    description:
      "Discover stronger product opportunities through supplier intelligence, marketplace monitoring, and trend-led discovery.",
    url: "https://quickaibuy.com/",
    siteName: "QuickAIBuy",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "QuickAIBuy | AI-Powered Product Discovery Intelligence",
    description:
      "Discover stronger product opportunities through supplier intelligence, marketplace monitoring, and trend-led discovery.",
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
