import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerOrders, customers, orders } from "@/lib/db/schema";
import { linkOrderToCanonicalCustomerTx } from "@/lib/orders/customerIntelligence";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

function uid(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createOrder(input: {
  marketplaceOrderId: string;
  buyerName: string;
  buyerCountry: string;
  totalPrice: string;
  currency: string;
  buyerEmail?: string | null;
  buyerUsername?: string | null;
  city?: string | null;
  state?: string | null;
}) {
  const now = new Date();
  const inserted = await db.execute<{ id: string; created_at: string | Date }>(sql`
    INSERT INTO orders (
      marketplace,
      marketplace_order_id,
      buyer_name,
      buyer_country,
      raw_payload,
      total_price,
      currency,
      status,
      created_at
    )
    VALUES (
      ${"ebay"},
      ${input.marketplaceOrderId},
      ${input.buyerName},
      ${input.buyerCountry},
      ${JSON.stringify({
        buyerEmail: input.buyerEmail ?? null,
        buyerUsername: input.buyerUsername ?? null,
        shippingAddress: {
          city: input.city ?? null,
          stateOrProvince: input.state ?? null,
          countryCode: input.buyerCountry,
        },
      })}::jsonb,
      ${input.totalPrice},
      ${input.currency},
      ${"MANUAL_REVIEW"},
      ${now}
    )
    RETURNING id, created_at
  `);

  return { id: inserted.rows[0].id, createdAt: new Date(inserted.rows[0].created_at) };
}

async function main() {
  const suffix = uid("cust-test");

  // Case 1 + 2: create then repeat by email updates same customer aggregate
  const orderA = await createOrder({
    marketplaceOrderId: `A-${suffix}`,
    buyerName: "Alice Buyer",
    buyerCountry: "US",
    totalPrice: "10.00",
    currency: "USD",
    buyerEmail: `alice+${suffix}@example.com`,
    buyerUsername: `alice-${suffix}`,
    city: "Austin",
    state: "TX",
  });

  await db.transaction(async (tx) => {
    await linkOrderToCanonicalCustomerTx(tx, {
      orderId: orderA.id,
      marketplace: "ebay",
      customerExternalId: `alice-${suffix}`,
      buyerName: "Alice Buyer",
      buyerEmail: `alice+${suffix}@example.com`,
      city: "Austin",
      state: "TX",
      country: "US",
      orderCreatedAt: orderA.createdAt,
      orderTotal: "10.00",
      orderCurrency: "USD",
    });
  });

  const orderB = await createOrder({
    marketplaceOrderId: `B-${suffix}`,
    buyerName: "Alice Buyer",
    buyerCountry: "US",
    totalPrice: "15.00",
    currency: "USD",
    buyerEmail: `alice+${suffix}@example.com`,
    buyerUsername: `alice-${suffix}`,
    city: "Austin",
    state: "TX",
  });

  await db.transaction(async (tx) => {
    await linkOrderToCanonicalCustomerTx(tx, {
      orderId: orderB.id,
      marketplace: "ebay",
      customerExternalId: `alice-${suffix}`,
      buyerName: "Alice Buyer",
      buyerEmail: `alice+${suffix}@example.com`,
      city: "Austin",
      state: "TX",
      country: "US",
      orderCreatedAt: orderB.createdAt,
      orderTotal: "15.00",
      orderCurrency: "USD",
    });
  });

  const alice = (
    await db
      .select({ id: customers.id, orderCount: customers.orderCount, totalSpent: customers.totalSpent })
      .from(customers)
      .where(
        and(
          eq(customers.marketplace, "ebay"),
          eq(customers.buyerEmailNormalized, `alice+${suffix}@example.com`)
        )
      )
      .limit(1)
  )[0];

  assert(Boolean(alice), "Expected canonical customer by email to exist");
  assert(alice.orderCount === 2, `Expected orderCount=2, got ${alice.orderCount}`);
  assert(Number(alice.totalSpent) === 25, `Expected totalSpent=25, got ${alice.totalSpent}`);

  // Case 3: ambiguous identity (email conflicts with external id) must not merge records
  const existingEmailCustomer = (
    await db
      .insert(customers)
      .values({
        marketplace: "ebay",
        buyerEmailNormalized: `conflict+${suffix}@example.com`,
        buyerName: "Conflict Email",
        firstOrderAt: new Date(),
        lastOrderAt: new Date(),
        orderCount: 0,
        totalSpent: "0",
        currency: "USD",
      })
      .onConflictDoNothing()
      .returning({ id: customers.id })
  )[0];

  const existingExternalCustomer = (
    await db
      .insert(customers)
      .values({
        marketplace: "ebay",
        customerExternalId: `conflict-ext-${suffix}`,
        buyerName: "Conflict External",
        firstOrderAt: new Date(),
        lastOrderAt: new Date(),
        orderCount: 0,
        totalSpent: "0",
        currency: "USD",
      })
      .onConflictDoNothing()
      .returning({ id: customers.id })
  )[0];

  assert(Boolean(existingEmailCustomer) && Boolean(existingExternalCustomer), "Expected seed conflict customers");

  const conflictOrder = await createOrder({
    marketplaceOrderId: `C-${suffix}`,
    buyerName: "Conflict Buyer",
    buyerCountry: "US",
    totalPrice: "7.00",
    currency: "USD",
    buyerEmail: `conflict+${suffix}@example.com`,
    buyerUsername: `conflict-ext-${suffix}`,
    city: "Seattle",
    state: "WA",
  });

  const conflictResolution = await db.transaction(async (tx) =>
    linkOrderToCanonicalCustomerTx(tx, {
      orderId: conflictOrder.id,
      marketplace: "ebay",
      customerExternalId: `conflict-ext-${suffix}`,
      buyerName: "Conflict Buyer",
      buyerEmail: `conflict+${suffix}@example.com`,
      city: "Seattle",
      state: "WA",
      country: "US",
      orderCreatedAt: conflictOrder.createdAt,
      orderTotal: "7.00",
      orderCurrency: "USD",
    })
  );

  assert(
    conflictResolution.resolutionMethod === "email_conflict_external_mismatch",
    `Expected safe mismatch resolution, got ${conflictResolution.resolutionMethod}`
  );

  const linked = (
    await db
      .select({ customerId: customerOrders.customerId, mergeSource: customerOrders.mergeSource })
      .from(customerOrders)
      .where(eq(customerOrders.orderId, conflictOrder.id))
      .limit(1)
  )[0];

  assert(Boolean(linked), "Expected conflict order to be linked");
  assert(linked.customerId !== existingExternalCustomer.id, "Conflict should not auto-merge to external-id customer");

  // Case 4: export columns exist on master and facts datasets
  const masterCols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers'
  `);
  const factsCols = await db.execute<{ column_name: string }>(sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customer_orders'
  `);

  const masterSet = new Set((masterCols.rows ?? []).map((r) => r.column_name));
  const factsSet = new Set((factsCols.rows ?? []).map((r) => r.column_name));

  for (const col of [
    "marketplace",
    "buyer_name",
    "buyer_email_normalized",
    "country",
    "state",
    "city",
    "order_count",
    "total_spent",
    "first_order_at",
    "last_order_at",
  ]) {
    assert(masterSet.has(col), `Missing master export column ${col}`);
  }

  for (const col of [
    "marketplace",
    "buyer_name_snapshot",
    "buyer_email_normalized",
    "country_snapshot",
    "state_snapshot",
    "city_snapshot",
    "order_total",
    "order_created_at",
  ]) {
    assert(factsSet.has(col), `Missing fact export column ${col}`);
  }

  // Case 5: linkage consistency check
  const inconsistencies = await db.execute<{ bad_count: number }>(sql`
    SELECT COUNT(*)::int AS bad_count
    FROM customer_orders co
    LEFT JOIN customers c ON c.id = co.customer_id
    LEFT JOIN orders o ON o.id = co.order_id
    WHERE c.id IS NULL OR o.id IS NULL
  `);
  const bad = inconsistencies.rows?.[0]?.bad_count ?? 0;
  assert(bad === 0, `Expected zero broken customer/order links, got ${bad}`);

  console.log(JSON.stringify({ ok: true, message: "customer intelligence checks passed" }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2));
  process.exit(1);
});
