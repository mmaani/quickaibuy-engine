"use client";

import { FormEvent, useMemo, useState } from "react";

type ContactForm = {
  name: string;
  company: string;
  email: string;
  interest: string;
  message: string;
};

const navItems = [
  { label: "Why Now", href: "#why-now" },
  { label: "Platform", href: "#platform" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Benefits", href: "#benefits" },
  { label: "FAQ", href: "#faq" },
  { label: "Contact", href: "#contact" },
];

const metrics = [
  { value: "eBay-first (v1)", label: "current live marketplace scope" },
  { value: "Guarded Publish Path", label: "manual approval with safety gates" },
  { value: "Jordan-aware Profit Model", label: "conservative net-profit logic" },
  { value: "Order Automation Foundation", label: "manual-assisted purchase/tracking flow" },
];

const features = [
  {
    title: "Supplier Product Intelligence",
    desc: "Transform raw supplier catalogs into structured product opportunities that can be reviewed, matched, and scored.",
  },
  {
    title: "Marketplace Monitoring",
    desc: "Track listing price, shipping, seller context, and availability to validate demand, margin, and publish readiness.",
  },
  {
    title: "AI Product Matching",
    desc: "Connect supplier products with marketplace listings using similarity logic, keyword extraction, and data normalization.",
  },
  {
    title: "Trend Discovery Mode",
    desc: "Expand early trend signals into product candidates before they become crowded and expensive to enter.",
  },
  {
    title: "Profitability Scoring",
    desc: "Estimate opportunity quality by combining pricing, costs, shipping assumptions, and signal confidence into one workflow.",
  },
  {
    title: "Operator-First Admin Surfaces",
    desc: "Purpose-built admin surfaces for review, listings, control, and safe operational decisions before broad automation.",
  },
];

const whyNowCards = [
  {
    title: "Discovery is fragmented",
    desc: "Supplier data, marketplace pricing, and trend signals usually live in separate systems, slowing decisions and hiding opportunities.",
  },
  {
    title: "Manual research is too slow",
    desc: "When sellers and prices move constantly, spreadsheets and manual checks become a competitive disadvantage.",
  },
  {
    title: "AI can compress decision time",
    desc: "The real edge is not only better data. It is turning scattered inputs into ranked actions much faster.",
  },
  {
    title: "Safety-first expansion path",
    desc: "Start with controlled execution and strong visibility now, then expand automation phase-by-phase with explicit safeguards.",
  },
];

const workflow = [
  "Ingest supplier products and trend signals",
  "Normalize data into structured pipeline records",
  "Match products to relevant marketplace listings",
  "Capture pricing, shipping, seller, and availability context",
  "Run profitability + price-guard safety validation",
  "Move approved opportunities through guarded listing lifecycle",
];

const benefitGroups = [
  {
    title: "For potential customers",
    points: [
      "Reduce manual sourcing and price-checking time",
      "Validate products against real marketplace data before publish",
      "Spot trend-led opportunities earlier",
      "Operate with explicit review and control surfaces",
    ],
  },
  {
    title: "For potential investors",
    points: [
      "Clear commercial use case with repeat operational value",
      "Expandable path from intelligence engine to execution platform",
      "Lean architecture already aligned with real workflow stages",
      "Multiple future monetization layers beyond monitoring alone",
    ],
  },
];

const faqItems = [
  {
    q: "What is QuickAIBuy?",
    a: "QuickAIBuy is an AI-powered product discovery and arbitrage intelligence platform designed to combine supplier sourcing, marketplace monitoring, and trend-led opportunity detection into one scalable workflow.",
  },
  {
    q: "Who is it for?",
    a: "It is designed for ecommerce operators, product research teams, marketplace sellers, and strategic partners looking for faster commercial discovery and better product validation.",
  },
  {
    q: "Which marketplaces are currently in focus?",
    a: "v1 live execution is eBay-first with guarded controls. The architecture supports future marketplace expansion without weakening current safety gates.",
  },
  {
    q: "Does the contact form send to WhatsApp?",
    a: "Yes. On submit, the form opens WhatsApp with a prefilled message to your current number, which is +962791752686.",
  },
];

const dashboardRows = [
  {
    product: "Mini Label Printer",
    source: "Trend signal",
    market: "eBay",
    score: "91",
    status: "Priority review",
  },
  {
    product: "Portable Blender Bottle",
    source: "Supplier catalog",
    market: "eBay",
    score: "78",
    status: "Validate fees",
  },
  {
    product: "Magnetic Phone Cooler",
    source: "Trend signal",
    market: "eBay",
    score: "83",
    status: "Watch closely",
  },
  {
    product: "Wireless Car Vacuum",
    source: "Supplier catalog",
    market: "eBay",
    score: "89",
    status: "High potential",
  },
];

const initialForm: ContactForm = {
  name: "",
  company: "",
  email: "",
  interest: "Customer",
  message: "",
};

function SectionPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex rounded-full border border-sky-300/20 bg-sky-300/10 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-100">
      {children}
    </span>
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <div className="brand-mark">
        <div className="brand-mark-inner">
          <span className="brand-mark-letter">Q</span>
          <span className="brand-mark-dot" />
        </div>
      </div>

      <div className="leading-none">
        <div className="text-sm font-bold uppercase tracking-[0.28em] text-white">
          QuickAIBuy
        </div>
        <div className="mt-1 text-xs text-white/55">
          Product Discovery Intelligence
        </div>
      </div>
    </div>
  );
}

function MobileMenu() {
  return (
    <details className="lg:hidden">
      <summary className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/80">
        <span className="sr-only">Open menu</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 7H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 12H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M4 17H20" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </summary>

      <div className="glass-card mt-3 rounded-3xl p-4">
        <div className="flex flex-col gap-3">
          {navItems.map((item) => (
            <a
              key={item.label}
              href={item.href}
              className="rounded-2xl px-3 py-3 text-sm text-white/78 transition hover:bg-white/5 hover:text-white"
            >
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </details>
  );
}

export default function Home() {
  const [form, setForm] = useState<ContactForm>(initialForm);
  const [submitted, setSubmitted] = useState(false);

  const whatsappUrl = useMemo(() => {
    const lines = [
      "Hello, I’m interested in QuickAIBuy.",
      `Name: ${form.name || "-"}`,
      `Company: ${form.company || "-"}`,
      `Email: ${form.email || "-"}`,
      `Interest: ${form.interest || "-"}`,
      `Message: ${form.message || "-"}`,
    ];
    return `https://wa.me/962791752686?text=${encodeURIComponent(lines.join("\n"))}`;
  }, [form]);

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    if (typeof window !== "undefined") {
      window.open(whatsappUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <main className="min-h-screen overflow-hidden bg-app text-white">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "QuickAIBuy",
            applicationCategory: "BusinessApplication",
            operatingSystem: "Web",
            description:
              "AI-powered product discovery and arbitrage intelligence platform for supplier sourcing, marketplace pricing, and trend-led opportunity detection.",
            url: "https://quickaibuy.com/",
            offers: {
              "@type": "Offer",
              price: "0",
              priceCurrency: "USD",
            },
            publisher: {
              "@type": "Organization",
              name: "QuickAIBuy",
              url: "https://quickaibuy.com/",
              contactPoint: {
                "@type": "ContactPoint",
                telephone: "+962791752686",
                contactType: "sales",
              },
            },
          }),
        }}
      />

      <div className="pointer-events-none absolute inset-0">
        <div className="hero-orb hero-orb-a" />
        <div className="hero-orb hero-orb-b" />
        <div className="hero-orb hero-orb-c" />
        <div className="grid-overlay opacity-[0.16]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <header className="sticky top-0 z-50 pt-4">
          <div className="glass-card rounded-[28px] px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-4">
              <BrandMark />

              <nav className="hidden items-center gap-6 lg:flex">
                {navItems.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-sm font-medium text-white/70 transition hover:text-white"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>

              <div className="flex items-center gap-3">
                <a
                  href="#contact"
                  className="hidden rounded-2xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-50 sm:inline-flex"
                >
                  Contact Us
                </a>
                <MobileMenu />
              </div>
            </div>
          </div>
        </header>

        <section className="grid gap-12 pb-16 pt-10 md:pt-14 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:gap-14 lg:pb-24">
          <div className="animate-rise">
            <SectionPill>AI-powered product discovery intelligence</SectionPill>

            <h1 className="mt-5 max-w-4xl text-balance text-[2.2rem] font-extrabold leading-[1.03] tracking-[-0.04em] text-white sm:text-5xl lg:text-7xl">
              Run safer product discovery and guarded execution through{" "}
              <span className="bg-gradient-to-r from-sky-200 via-cyan-300 to-emerald-300 bg-clip-text text-transparent">
                supplier intelligence, marketplace monitoring, and operator-first controls
              </span>
              .
            </h1>

            <p className="mt-6 max-w-2xl text-pretty text-base leading-8 text-white/72 sm:text-lg">
              QuickAIBuy is an AI-powered product discovery and arbitrage intelligence
              engine built to help businesses identify commercially promising products,
              validate publish safety, and execute through controlled workflows.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href="#contact"
                className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-50"
              >
                Request a Conversation
              </a>
              <a
                href="#platform"
                className="inline-flex items-center justify-center rounded-2xl border border-white/12 bg-white/5 px-6 py-3.5 text-sm font-semibold text-white transition hover:bg-white/8"
              >
                Explore the Platform
              </a>
            </div>

            <div className="mt-8 flex flex-wrap items-center gap-3 text-sm text-white/58">
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                Built for operator-controlled workflows
              </span>
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                Current live focus: eBay-first
              </span>
              <span className="inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                Contact-ready via WhatsApp
              </span>
            </div>

            <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {metrics.map((item) => (
                <div key={item.label} className="glass-card rounded-2xl p-4">
                  <div className="text-sm font-semibold text-white sm:text-base">
                    {item.value}
                  </div>
                  <div className="mt-1 text-xs leading-5 text-white/55 sm:text-sm">
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="animate-rise-delayed lg:-mt-6">
            <div className="dashboard-frame rounded-[32px] p-3 sm:p-4">
              <div className="glass-panel rounded-[28px] p-4 sm:p-5">
                <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                      Dashboard Preview
                    </p>
                    <h2 className="mt-1 text-lg font-bold text-white sm:text-xl">
                      Opportunity Command Center
                    </h2>
                  </div>

                  <div className="inline-flex w-fit rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                    Planned dashboard layer
                  </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                        Pipeline status
                      </div>

                      <div className="mt-4 space-y-3">
                        {[
                          ["Supplier ingest", "Active"],
                          ["Marketplace scan", "Running"],
                          ["AI matching", "Queued"],
                          ["Profit scoring", "Ready"],
                        ].map(([label, state]) => (
                          <div
                            key={label}
                            className="flex items-center justify-between rounded-xl bg-black/15 px-3 py-2.5"
                          >
                            <span className="text-sm text-white/72">{label}</span>
                            <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-2.5 py-1 text-[11px] font-semibold text-sky-100">
                              {state}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                      <div className="flex items-end justify-between gap-4">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                            Signal mix
                          </div>
                          <div className="mt-2 text-xl font-bold text-white sm:text-2xl">
                            Trend + supplier blend
                          </div>
                        </div>
                      <div className="text-right text-xs text-white/48">
                          controlled rollout
                        </div>
                      </div>

                      <div className="mt-5 space-y-4">
                        {[
                          { label: "Supplier pipeline", width: "78%" },
                          { label: "Marketplace coverage", width: "66%" },
                          { label: "Trend candidates", width: "54%" },
                        ].map((bar) => (
                          <div key={bar.label}>
                            <div className="mb-2 flex items-center justify-between text-sm text-white/65">
                              <span>{bar.label}</span>
                              <span>{bar.width}</span>
                            </div>
                            <div className="h-2.5 rounded-full bg-white/8">
                              <div
                                className="h-2.5 rounded-full bg-gradient-to-r from-sky-300 via-cyan-300 to-emerald-300"
                                style={{ width: bar.width }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">
                        Candidate review
                      </div>
                      <div className="text-xs text-white/48">live-style preview</div>
                    </div>

                    <div className="mt-4 overflow-hidden rounded-2xl border border-white/8">
                      <div className="hidden grid-cols-[1.45fr_0.85fr_0.85fr_0.55fr_0.95fr] gap-3 border-b border-white/8 bg-white/[0.05] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45 md:grid">
                        <span>Product</span>
                        <span>Source</span>
                        <span>Market</span>
                        <span>Score</span>
                        <span>Status</span>
                      </div>

                      <div className="divide-y divide-white/8 bg-black/10">
                        {dashboardRows.map((row) => (
                          <div key={row.product}>
                            <div className="hidden grid-cols-[1.45fr_0.85fr_0.85fr_0.55fr_0.95fr] gap-3 px-4 py-3 text-sm text-white/74 md:grid">
                              <span className="font-medium text-white">{row.product}</span>
                              <span>{row.source}</span>
                              <span>{row.market}</span>
                              <span className="font-semibold text-sky-200">{row.score}</span>
                              <span>{row.status}</span>
                            </div>

                            <div className="space-y-2 px-4 py-4 md:hidden">
                              <div className="text-sm font-semibold text-white">{row.product}</div>
                              <div className="flex flex-wrap gap-2 text-xs text-white/62">
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                                  {row.source}
                                </span>
                                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                                  {row.market}
                                </span>
                                <span className="rounded-full border border-sky-300/15 bg-sky-300/10 px-2 py-1 text-sky-100">
                                  Score {row.score}
                                </span>
                              </div>
                              <div className="text-sm text-white/65">{row.status}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="mt-4 rounded-2xl border border-sky-300/15 bg-sky-300/8 p-4 text-sm leading-7 text-sky-50/90">
                      This dashboard direction is designed to make opportunity review easier
                      for customers now and more investable as a software product later.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="why-now" className="section-block">
          <div className="max-w-3xl">
            <SectionPill>Why now</SectionPill>
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
              Commerce moves faster. Discovery systems need to catch up.
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-base leading-8 text-white/68 sm:text-lg">
              QuickAIBuy is positioned for a market where sourcing, pricing,
              and demand signals change constantly, and where faster validation
              can become a serious operating advantage.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {whyNowCards.map((item, idx) => (
              <div
                key={item.title}
                className="glass-card rounded-3xl p-6"
                style={{ animationDelay: `${idx * 70}ms` }}
              >
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-sky-300/12 text-sm font-bold text-sky-100">
                  {idx + 1}
                </div>
                <h3 className="text-xl font-bold text-white">{item.title}</h3>
                <p className="mt-4 text-sm leading-7 text-white/62 sm:text-base">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="platform" className="section-block">
          <div className="max-w-3xl">
            <SectionPill>Platform</SectionPill>
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
              Built for product discovery, publish safety, and scalable review workflows
            </h2>
            <p className="mt-5 text-pretty text-base leading-8 text-white/68 sm:text-lg">
              The platform combines discovery intelligence with operational safeguards
              so teams can move forward faster without losing control.
            </p>
          </div>

          <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="glass-card rounded-3xl p-6 transition hover:-translate-y-1 hover:border-sky-300/22 hover:bg-white/[0.07]"
              >
                <h3 className="text-xl font-bold text-white">{feature.title}</h3>
                <p className="mt-4 text-sm leading-7 text-white/62 sm:text-base">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section id="how-it-works" className="section-block">
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div>
              <SectionPill>How it works</SectionPill>
              <h2 className="mt-5 text-balance text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
                From fragmented inputs to opportunity-ready signals
              </h2>
              <p className="mt-5 text-pretty text-base leading-8 text-white/68 sm:text-lg">
                QuickAIBuy is structured to reduce manual research by turning supplier,
                marketplace, and trend data into ranked product candidates.
              </p>
            </div>

            <div className="space-y-4">
              {workflow.map((step, idx) => (
                <div key={step} className="glass-card flex gap-4 rounded-3xl p-5">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-300/12 text-sm font-bold text-sky-100">
                    {idx + 1}
                  </div>
                  <div className="pt-1 text-sm leading-7 text-white/75 sm:text-base">
                    {step}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="benefits" className="section-block">
          <div className="grid gap-4 lg:grid-cols-2">
            {benefitGroups.map((group, index) => (
              <div key={group.title} className="glass-card rounded-[30px] p-7 sm:p-8">
                <SectionPill>{index === 0 ? "Customers" : "Investors"}</SectionPill>
                <h2 className="mt-5 text-balance text-2xl font-bold tracking-[-0.03em] text-white sm:text-3xl">
                  {group.title}
                </h2>

                <div className="mt-6 space-y-4">
                  {group.points.map((point) => (
                    <div key={point} className="flex gap-3">
                      <div className="mt-2 h-2.5 w-2.5 rounded-full bg-sky-300" />
                      <p className="text-sm leading-7 text-white/70 sm:text-base">{point}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section id="faq" className="section-block">
          <div className="max-w-3xl">
            <SectionPill>FAQ</SectionPill>
            <h2 className="mt-5 text-balance text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl lg:text-5xl">
              Common questions
            </h2>
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-2">
            {faqItems.map((item) => (
              <details key={item.q} className="glass-card rounded-3xl p-6">
                <summary className="cursor-pointer list-none text-lg font-bold text-white">
                  {item.q}
                </summary>
                <p className="mt-4 text-sm leading-7 text-white/66 sm:text-base">
                  {item.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        <section id="contact" className="pb-24 pt-8">
          <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr] lg:items-start">
            <div className="glass-card rounded-[32px] p-7 sm:p-8 lg:p-10">
              <SectionPill>Contact</SectionPill>
              <h2 className="mt-5 text-balance text-3xl font-bold tracking-[-0.03em] text-white sm:text-4xl">
                Start the conversation
              </h2>
              <p className="mt-5 text-pretty text-base leading-8 text-white/68 sm:text-lg">
                For now, the form opens a prefilled WhatsApp message directly to your number.
                Later, we can connect it to a proper backend, CRM, email routing, and your
                admin operations stack.
              </p>

              <div className="mt-8 space-y-4">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] p-5">
                  <div className="text-sm font-semibold text-white">Direct contact</div>
                  <div className="mt-2 text-white/68">Phone / WhatsApp: +962 79 175 2686</div>
                </div>

                <div className="rounded-2xl border border-emerald-300/15 bg-emerald-300/8 p-5 text-sm leading-7 text-emerald-50/90">
                  Best next upgrade: store submissions in a database, send notifications to email and WhatsApp,
                  and connect lead status to the future dashboard.
                </div>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="glass-card rounded-[32px] p-7 sm:p-8 lg:p-10">
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white/72">Full name</span>
                  <input
                    className="contact-input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Your name"
                    required
                  />
                </label>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-white/72">Company</span>
                  <input
                    className="contact-input"
                    value={form.company}
                    onChange={(e) => setForm({ ...form, company: e.target.value })}
                    placeholder="Company or fund"
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-white/72">Email</span>
                  <input
                    type="email"
                    className="contact-input"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    placeholder="name@company.com"
                    required
                  />
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-white/72">I am interested as</span>
                  <select
                    className="contact-input"
                    value={form.interest}
                    onChange={(e) => setForm({ ...form, interest: e.target.value })}
                  >
                    <option>Customer</option>
                    <option>Investor</option>
                    <option>Strategic Partner</option>
                    <option>General Inquiry</option>
                  </select>
                </label>

                <label className="block sm:col-span-2">
                  <span className="mb-2 block text-sm font-medium text-white/72">Message</span>
                  <textarea
                    className="contact-input min-h-[150px] resize-y"
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Tell us what you want to discuss."
                    required
                  />
                </label>
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-6 py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-sky-50"
                >
                  Send via WhatsApp
                </button>

                <a
                  href="tel:+962791752686"
                  className="text-sm font-medium text-sky-100 transition hover:text-white"
                >
                  Or call directly
                </a>
              </div>

              {submitted ? (
                <p className="mt-4 text-sm text-emerald-200">
                  Your message is opening in WhatsApp in a new tab.
                </p>
              ) : null}
            </form>
          </div>
        </section>

        <footer className="border-t border-white/8 pb-10 pt-8">
          <div className="grid gap-8 rounded-[28px] border border-white/8 bg-white/[0.03] p-6 sm:p-8 lg:grid-cols-[1.2fr_0.8fr_0.8fr]">
            <div>
              <BrandMark />
              <p className="mt-4 max-w-md text-sm leading-7 text-white/58">
                QuickAIBuy is an AI-powered product discovery intelligence platform
                focused on supplier sourcing, marketplace monitoring, and trend-led
                opportunity detection.
              </p>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/78">
                Navigation
              </h3>
              <div className="mt-4 flex flex-col gap-3">
                {navItems.map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="text-sm text-white/58 transition hover:text-white"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-white/78">
                Other Ventures
              </h3>
              <div className="mt-4 flex flex-col gap-3">
                <a
                  href="https://zomorodmedical.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white/58 transition hover:text-white"
                >
                  Zomorod Medical Supplies
                </a>
                <a
                  href="https://nivran.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-white/58 transition hover:text-white"
                >
                  NIVRAN Fragrance 
                </a>
                <a
                  href="tel:+962791752686"
                  className="pt-2 text-sm text-sky-100 transition hover:text-white"
                >
                  Contact: +962 79 175 2686
                </a>
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 text-xs text-white/38 sm:flex-row sm:items-center sm:justify-between">
            <span>© 2026 QuickAIBuy. All rights reserved.</span>
            <span>Built for future dashboard and listing workflows.</span>
          </div>
        </footer>
      </div>
    </main>
  );
}
