# Supplier Crawl Policy

QuickAIBuy contains supplier discovery and supplier product refresh logic. Supplier crawl work in this repo must follow these rules:

## Scope

- Supplier discovery, parsing, quality scoring, availability refresh, and supplier snapshot handling belong here.
- Supplier crawl outputs support QuickAIBuy matching, pricing, review, and listing decisions.

## Source Of Truth

- The source of truth is persisted application data in the QuickAIBuy database, not ad hoc local exports or manual spreadsheets.
- Runtime refresh scripts and worker jobs may populate or update supplier-derived records, but generated files are not source of truth.

## Operational Expectations

- Keep supplier refresh and discovery jobs environment-isolated through queue namespace settings.
- Fail closed when required runtime dependencies are missing.
- Use env-based configuration only; do not hardcode supplier credentials or tokens.
- Preserve traceability through existing diagnostics, job ledgers, and audit-friendly scripts where available.

## Runtime Artifact Handling

- Do not commit transient crawl output, local scrape dumps, or debug exports unless they are intentional fixtures approved for source control.
- Keep local env files and runtime bundles out of generated source packages.

## Boundaries

- Do not repurpose supplier crawl logic for unrelated projects or verticals.
- Do not add unsupported scraping policies or compliance claims to this doc without repo evidence.
