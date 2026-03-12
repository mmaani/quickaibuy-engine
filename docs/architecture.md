# QuickAIBuy Architecture

## Purpose

QuickAIBuy is an operator-first ecommerce intelligence and execution platform.

It is designed to:

- discover supplier products
- scan marketplace pricing
- evaluate profitability
- enforce operator review
- prepare and publish guarded marketplace listings
- support manual-assisted order operations
- fail closed when data is stale, risky, or incomplete

The system is intentionally **explicit, auditable, and operator-controlled** in v1.

---

## High-Level Pipeline

```text
SUPPLIERS
  Alibaba / Temu / AliExpress
        ↓
SUPPLIER CRAWLERS
        ↓
products_raw
        ↓
MATCHING / DISCOVERY
        ↓
matches
        ↓
MARKETPLACE SCANNER
        ↓
marketplace_prices
        ↓
PROFIT ENGINE + PRICE GUARD
        ↓
profitable_candidates
        ↓
/admin/review
human approval gate
        ↓
LISTING PREPARATION
        ↓
listings: PREVIEW
        ↓
operator promotion
        ↓
listings: READY_TO_PUBLISH
        ↓
PUBLISH WORKER (guarded, eBay only in v1)
        ↓
ACTIVE / PUBLISH_FAILED
        ↓
LISTING MONITOR
        ↓
/admin/control
```
