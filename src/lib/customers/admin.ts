import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerOrders, customers } from "@/lib/db/schema";

export type CustomerListFilter = {
  country?: string | null;
  city?: string | null;
  repeat?: "repeat" | "first" | "all";
  limit?: number;
};

export type CustomerRow = {
  id: string;
  marketplace: string;
  customerExternalId: string | null;
  buyerName: string | null;
  buyerEmailNormalized: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  orderCount: number;
  totalSpent: string;
  currency: string | null;
  firstOrderAt: string;
  lastOrderAt: string;
  repeatCustomerFlag: boolean;
};

function clean(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  return v.length ? v : null;
}

export async function listCustomers(input?: CustomerListFilter): Promise<CustomerRow[]> {
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 250), 2000));
  const whereParts: Array<ReturnType<typeof eq> | ReturnType<typeof ilike> | ReturnType<typeof sql>> = [];

  const country = clean(input?.country);
  const city = clean(input?.city);
  const repeat = input?.repeat ?? "all";

  if (country) whereParts.push(eq(customers.country, country));
  if (city) whereParts.push(ilike(customers.city, city));
  if (repeat === "repeat") whereParts.push(sql`${customers.orderCount} >= 2`);
  if (repeat === "first") whereParts.push(sql`${customers.orderCount} = 1`);

  const where = whereParts.length ? and(...whereParts) : undefined;
  const rows = await db
    .select({
      id: customers.id,
      marketplace: customers.marketplace,
      customerExternalId: customers.customerExternalId,
      buyerName: customers.buyerName,
      buyerEmailNormalized: customers.buyerEmailNormalized,
      country: customers.country,
      state: customers.state,
      city: customers.city,
      orderCount: customers.orderCount,
      totalSpent: sql<string>`COALESCE(${customers.totalSpent}::text, '0')`,
      currency: customers.currency,
      firstOrderAt: sql<string>`${customers.firstOrderAt}::text`,
      lastOrderAt: sql<string>`${customers.lastOrderAt}::text`,
      repeatCustomerFlag: sql<boolean>`${customers.orderCount} >= 2`,
    })
    .from(customers)
    .where(where)
    .orderBy(desc(customers.lastOrderAt))
    .limit(limit);

  return rows;
}

export async function getCustomerDetail(customerId: string): Promise<{
  customer: CustomerRow | null;
  orders: Array<{
    orderId: string;
    marketplace: string;
    mergeSource: string;
    identityConfidence: string;
    resolutionMethod: string;
    country: string | null;
    state: string | null;
    city: string | null;
    orderCreatedAt: string;
    orderTotal: string | null;
    orderCurrency: string | null;
  }>;
}>
{
  const customer = (
    await db
      .select({
        id: customers.id,
        marketplace: customers.marketplace,
        customerExternalId: customers.customerExternalId,
        buyerName: customers.buyerName,
        buyerEmailNormalized: customers.buyerEmailNormalized,
        country: customers.country,
        state: customers.state,
        city: customers.city,
        orderCount: customers.orderCount,
        totalSpent: sql<string>`COALESCE(${customers.totalSpent}::text, '0')`,
        currency: customers.currency,
        firstOrderAt: sql<string>`${customers.firstOrderAt}::text`,
        lastOrderAt: sql<string>`${customers.lastOrderAt}::text`,
        repeatCustomerFlag: sql<boolean>`${customers.orderCount} >= 2`,
      })
      .from(customers)
      .where(eq(customers.id, customerId))
      .limit(1)
  )[0] ?? null;

  if (!customer) return { customer: null, orders: [] };

  const ordersRows = await db
    .select({
      orderId: customerOrders.orderId,
      marketplace: customerOrders.marketplace,
      mergeSource: customerOrders.mergeSource,
      identityConfidence: customerOrders.identityConfidence,
      resolutionMethod: customerOrders.resolutionMethod,
      country: customerOrders.countrySnapshot,
      state: customerOrders.stateSnapshot,
      city: customerOrders.citySnapshot,
      orderCreatedAt: sql<string>`${customerOrders.orderCreatedAt}::text`,
      orderTotal: sql<string | null>`CASE WHEN ${customerOrders.orderTotal} IS NULL THEN NULL ELSE ${customerOrders.orderTotal}::text END`,
      orderCurrency: customerOrders.orderCurrency,
    })
    .from(customerOrders)
    .where(eq(customerOrders.customerId, customerId))
    .orderBy(desc(customerOrders.orderCreatedAt));

  return { customer, orders: ordersRows };
}

export async function customerMasterDataset() {
  return listCustomers({ limit: 50000, repeat: "all" });
}

export async function customerOrderFactsDataset() {
  const rows = await db
    .select({
      customerId: customerOrders.customerId,
      orderId: customerOrders.orderId,
      marketplace: customerOrders.marketplace,
      buyerName: customerOrders.buyerNameSnapshot,
      buyerEmailNormalized: customerOrders.buyerEmailNormalized,
      country: customerOrders.countrySnapshot,
      state: customerOrders.stateSnapshot,
      city: customerOrders.citySnapshot,
      mergeSource: customerOrders.mergeSource,
      identityConfidence: customerOrders.identityConfidence,
      resolutionMethod: customerOrders.resolutionMethod,
      orderCreatedAt: sql<string>`${customerOrders.orderCreatedAt}::text`,
      orderTotal: sql<string | null>`CASE WHEN ${customerOrders.orderTotal} IS NULL THEN NULL ELSE ${customerOrders.orderTotal}::text END`,
      orderCurrency: customerOrders.orderCurrency,
    })
    .from(customerOrders)
    .orderBy(desc(customerOrders.orderCreatedAt));

  return rows;
}

export async function customerGeoSummaryDataset() {
  const rows = await db.execute<{
    marketplace: string;
    country: string | null;
    state: string | null;
    city: string | null;
    customerCount: number;
    repeatCustomerCount: number;
    orderCount: number;
    totalSpent: string;
  }>(sql`
    SELECT
      c.marketplace AS "marketplace",
      c.country AS "country",
      c.state AS "state",
      c.city AS "city",
      COUNT(*)::int AS "customerCount",
      SUM(CASE WHEN c.order_count >= 2 THEN 1 ELSE 0 END)::int AS "repeatCustomerCount",
      SUM(c.order_count)::int AS "orderCount",
      COALESCE(SUM(c.total_spent), 0)::text AS "totalSpent"
    FROM customers c
    GROUP BY c.marketplace, c.country, c.state, c.city
    ORDER BY "orderCount" DESC
  `);

  return rows.rows ?? [];
}
