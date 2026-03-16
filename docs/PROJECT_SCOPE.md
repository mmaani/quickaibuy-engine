# QuickAIBuy Project Scope

## Project Definition

QuickAIBuy is an operator-first marketplace automation and ecommerce intelligence system. This repository is the QuickAIBuy engine for supplier discovery, product matching, marketplace price scanning, listing automation, order operations, profit evaluation, inventory monitoring, admin dashboards, workers, scripts, queues, and database flows that support the marketplace pipeline.

Repo: `quickaibuy-engine`

## In Scope

- supplier crawling and supplier product refresh flows
- trend ingestion and product discovery
- product matching and marketplace matching
- marketplace price scanning and profitability evaluation
- review consoles, control panels, and operator dashboards
- listing preparation, listing previews, guarded publish, and listing monitoring
- order ingestion, operator-assisted purchase handling, and tracking sync
- inventory risk monitoring
- queue, worker, migration, and runtime diagnostics for the QuickAIBuy pipeline

## Out of Scope

The following do not belong in this repo:

- Zomorod Medical Supplies
- Nivran
- medical supplies CRM or recruitment workflows
- Google Drive CV upload flows
- perfume, fragrance, or packaging operations
- unrelated ecommerce brand sites or unrelated back-office systems

## Isolation Rule

Never mix QuickAIBuy work with Zomorod Medical Supplies or Nivran. If a task, instruction, file, term, UI element, script, or architecture note suggests another project, stop immediately and report:

`PROJECT MISMATCH DETECTED`
