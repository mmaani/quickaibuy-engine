# Order Automation Rollout and Migration Consistency

## Why migration conflicts happened
The project currently has two migration tracks:

1. `pnpm db:migrate` applies Drizzle migrations from `drizzle/`.
2. Most operational schema updates (including order automation B1-B5/C2) are in `migrations/*.sql` and are typically applied with `node scripts/mutate_execute_sql_file.mjs ...`.

Because the order-automation chain is SQL-file based, environments can drift if:
- SQL files were applied manually in one environment but not another.
- only `pnpm db:migrate` was run and `migrations/20260311*.sql` were not applied.
- additive SQL was run out-of-band without a deterministic post-check.

## Required order-automation migration chain
Apply in this order when missing:

1. `migrations/20260311_order_automation_foundation.sql`
2. `migrations/20260311b_order_items_supplier_linkage_nullable.sql`
3. `migrations/20260311c_supplier_orders_manual_workflow_fields.sql`
4. `migrations/20260311d_supplier_orders_add_tracking_carrier.sql`
5. `migrations/20260311e_supplier_orders_tracking_sync_fields.sql`

## Deterministic readiness checks
Use these checks before and after migration rollout:

```bash
pnpm exec tsx scripts/check_order_automation_schema.ts
pnpm exec tsx scripts/check_order_automation_runtime_ready.ts
```

What they verify:
- required tables: `orders`, `order_items`, `order_events`, `supplier_orders`
- required columns for B1-B5/C2 behavior
- required index targets (logical column coverage, not fragile index names only)
- required FK links from child tables to `orders`
- runtime readiness summary for:
  - order sync
  - manual purchase flow
  - tracking sync
  - `/admin/orders`

## Safe rollout sequence (local/staging/prod)
1. **Pre-check fingerprint and schema**
```bash
node scripts/check_runtime_db_fingerprint.mjs
pnpm exec tsx scripts/check_order_automation_schema.ts
```

2. **Apply migration layers**
- Run normal migration command for Drizzle-managed track:
```bash
pnpm db:migrate
```
- Apply order automation SQL chain if schema checks show missing order objects:
```bash
node scripts/mutate_execute_sql_file.mjs migrations/20260311_order_automation_foundation.sql
node scripts/mutate_execute_sql_file.mjs migrations/20260311b_order_items_supplier_linkage_nullable.sql
node scripts/mutate_execute_sql_file.mjs migrations/20260311c_supplier_orders_manual_workflow_fields.sql
node scripts/mutate_execute_sql_file.mjs migrations/20260311d_supplier_orders_add_tracking_carrier.sql
node scripts/mutate_execute_sql_file.mjs migrations/20260311e_supplier_orders_tracking_sync_fields.sql
```

3. **Post-check deterministic readiness**
```bash
pnpm exec tsx scripts/check_order_automation_schema.ts
pnpm exec tsx scripts/check_order_automation_runtime_ready.ts
pnpm exec tsx scripts/check_tracking_sync_readiness.ts
```

4. **Only then run order-automation paths**
- order sync worker/actions
- manual purchase flow actions
- tracking readiness and eBay tracking sync actions
- `/admin/orders`

## Baseline conflict handling guidance
If `pnpm db:migrate` reports baseline conflicts but order schema is incomplete:
- do not guess state from migration history alone.
- use the schema checks above as source of truth.
- apply only missing additive SQL files from the order chain.
- rerun checks until `schemaReady=true` and `safeForOrderAutomationRuntime=true`.

## Manual step that still exists
There is still a manual operational decision point:
- if an environment has inconsistent history, an operator may need to apply additive SQL files directly.

The hardening in this phase makes that step observable and repeatable through deterministic checks; it does not hide drift behind optimistic assumptions.
