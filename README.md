# QuickAIBuy Engine

QuickAIBuy is an operator-first ecommerce intelligence and execution system.

The system prioritizes **safe operations, operator visibility, and fail-closed automation boundaries**.

Current focus:
- `eBay` live execution path (guarded)
- manual approval gates before listing execution
- manual-assisted order workflow and tracking sync controls
- admin consoles for review, listings, orders, and incident control

---

# Core Admin Routes

- `/dashboard` – monitoring dashboard with links to admin consoles
- `/admin/control` – operational control panel, safety alerts, manual overrides
- `/admin/review` – candidate review and approval gate
- `/admin/listings` – listing readiness and lifecycle operations
- `/admin/orders` – manual-assisted order operations (purchase/tracking/sync)

These surfaces form the **daily operating interface for system operators**.

---

# Operator Runbook

QuickAIBuy uses an **operator-first safety model**.

All incident handling and operational procedures are documented in:
- `docs/operator-runbook.md`
- `docs/runtime-diagnostics.md`
- `docs/database-migrations.md`

---

# Upstash Safety Checks

- `DOTENV_CONFIG_PATH=.env.local node --import dotenv/config --import tsx scripts/check_supplier_queue.ts`
- `node --import tsx scripts/check_upstash_isolation.ts`
