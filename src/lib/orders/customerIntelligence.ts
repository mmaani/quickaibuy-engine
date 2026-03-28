import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerOrders, customers, orders } from "@/lib/db/schema";
type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type IdentityConfidence = "HIGH" | "MEDIUM" | "LOW";

export type CustomerIdentityInput = {
  marketplace: string;
  customerExternalId: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  orderCreatedAt: Date;
  orderTotal: string | null;
  orderCurrency: string | null;
};

export type CustomerResolution = {
  customerId: string;
  mergeSource: string;
  identityConfidence: IdentityConfidence;
  resolutionMethod: string;
  buyerEmailNormalized: string | null;
  customerExternalId: string | null;
};

function cleanString(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function normalizeBuyerEmail(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toLowerCase() : null;
}

function toCurrency(value: string | null | undefined): string | null {
  const cleaned = cleanString(value);
  return cleaned ? cleaned.toUpperCase() : null;
}

async function recomputeCustomerAggregatesTx(tx: DbTx, customerId: string) {
  const agg = await tx.execute<{
    firstOrderAt: Date | null;
    lastOrderAt: Date | null;
    orderCount: number;
    totalSpent: string | null;
    currency: string | null;
  }>(sql`
    SELECT
      MIN(co.order_created_at) AS "firstOrderAt",
      MAX(co.order_created_at) AS "lastOrderAt",
      COUNT(*)::int AS "orderCount",
      COALESCE(SUM(co.order_total), 0)::text AS "totalSpent",
      CASE
        WHEN COUNT(DISTINCT COALESCE(NULLIF(BTRIM(co.order_currency), ''), 'USD')) = 1
        THEN MAX(COALESCE(NULLIF(BTRIM(co.order_currency), ''), 'USD'))
        ELSE 'MIXED'
      END AS "currency"
    FROM customer_orders co
    WHERE co.customer_id = ${customerId}
  `);

  const row = agg.rows?.[0];
  if (!row || !row.firstOrderAt || !row.lastOrderAt) return;

  await tx
    .update(customers)
    .set({
      firstOrderAt: row.firstOrderAt,
      lastOrderAt: row.lastOrderAt,
      orderCount: row.orderCount,
      totalSpent: row.totalSpent ?? "0",
      currency: row.currency,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, customerId));
}

export async function resolveOrCreateCustomerTx(tx: DbTx, input: CustomerIdentityInput): Promise<CustomerResolution> {
  const marketplace = cleanString(input.marketplace)?.toLowerCase() ?? "ebay";
  const buyerEmailNormalized = normalizeBuyerEmail(input.buyerEmail);
  const customerExternalId = cleanString(input.customerExternalId);

  const emailRow = buyerEmailNormalized
    ? (
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.marketplace, marketplace),
              eq(customers.buyerEmailNormalized, buyerEmailNormalized)
            )
          )
          .limit(1)
      )[0] ?? null
    : null;

  const externalRow = customerExternalId
    ? (
        await tx
          .select({ id: customers.id })
          .from(customers)
          .where(
            and(
              eq(customers.marketplace, marketplace),
              eq(customers.customerExternalId, customerExternalId)
            )
          )
          .limit(1)
      )[0] ?? null
    : null;

  let selectedCustomerId: string | null = null;
  let mergeSource = "fallback_low_confidence";
  let identityConfidence: IdentityConfidence = "LOW";
  let resolutionMethod = "fallback_profile";

  if (emailRow && externalRow && emailRow.id !== externalRow.id) {
    selectedCustomerId = emailRow.id;
    mergeSource = "email_priority_external_conflict";
    identityConfidence = "MEDIUM";
    resolutionMethod = "email_conflict_external_mismatch";
  } else if (emailRow) {
    selectedCustomerId = emailRow.id;
    mergeSource = "marketplace_email";
    identityConfidence = "HIGH";
    resolutionMethod = "email_exact";
  } else if (externalRow) {
    selectedCustomerId = externalRow.id;
    mergeSource = "marketplace_external_id";
    identityConfidence = "HIGH";
    resolutionMethod = "external_id_exact";
  }

  if (!selectedCustomerId) {
    const insert = await tx
      .insert(customers)
      .values({
        marketplace,
        customerExternalId,
        buyerName: cleanString(input.buyerName),
        buyerEmailNormalized,
        city: cleanString(input.city),
        state: cleanString(input.state),
        country: cleanString(input.country),
        firstOrderAt: input.orderCreatedAt,
        lastOrderAt: input.orderCreatedAt,
        orderCount: 0,
        totalSpent: "0",
        currency: toCurrency(input.orderCurrency),
      })
      .returning({ id: customers.id });
    selectedCustomerId = insert[0].id;

    if (buyerEmailNormalized) {
      mergeSource = "marketplace_email";
      identityConfidence = "HIGH";
      resolutionMethod = "email_exact";
    } else if (customerExternalId) {
      mergeSource = "marketplace_external_id";
      identityConfidence = "HIGH";
      resolutionMethod = "external_id_exact";
    }
  }

  await tx
    .update(customers)
    .set({
      buyerName: sql`COALESCE(${cleanString(input.buyerName)}, ${customers.buyerName})`,
      city: sql`COALESCE(${cleanString(input.city)}, ${customers.city})`,
      state: sql`COALESCE(${cleanString(input.state)}, ${customers.state})`,
      country: sql`COALESCE(${cleanString(input.country)}, ${customers.country})`,
      buyerEmailNormalized: buyerEmailNormalized
        ? sql`COALESCE(${customers.buyerEmailNormalized}, ${buyerEmailNormalized})`
        : customers.buyerEmailNormalized,
      customerExternalId: customerExternalId
        ? sql`COALESCE(${customers.customerExternalId}, ${customerExternalId})`
        : customers.customerExternalId,
      updatedAt: new Date(),
    })
    .where(eq(customers.id, selectedCustomerId));

  return {
    customerId: selectedCustomerId,
    mergeSource,
    identityConfidence,
    resolutionMethod,
    buyerEmailNormalized,
    customerExternalId,
  };
}

export async function linkOrderToCanonicalCustomerTx(
  tx: DbTx,
  input: CustomerIdentityInput & { orderId: string }
): Promise<CustomerResolution> {
  const resolution = await resolveOrCreateCustomerTx(tx, input);

  const existingLink = (
    await tx
      .select({ id: customerOrders.id, customerId: customerOrders.customerId })
      .from(customerOrders)
      .where(eq(customerOrders.orderId, input.orderId))
      .limit(1)
  )[0] ?? null;

  const baseValues = {
    customerId: resolution.customerId,
    marketplace: cleanString(input.marketplace)?.toLowerCase() ?? "ebay",
    mergeSource: resolution.mergeSource,
    identityConfidence: resolution.identityConfidence,
    resolutionMethod: resolution.resolutionMethod,
    buyerEmailNormalized: resolution.buyerEmailNormalized,
    customerExternalId: resolution.customerExternalId,
    buyerNameSnapshot: cleanString(input.buyerName),
    citySnapshot: cleanString(input.city),
    stateSnapshot: cleanString(input.state),
    countrySnapshot: cleanString(input.country),
    orderCreatedAt: input.orderCreatedAt,
    orderTotal: input.orderTotal,
    orderCurrency: toCurrency(input.orderCurrency),
    updatedAt: new Date(),
  };

  if (!existingLink) {
    await tx.insert(customerOrders).values({
      orderId: input.orderId,
      ...baseValues,
    });
  } else {
    await tx.update(customerOrders).set(baseValues).where(eq(customerOrders.id, existingLink.id));
    if (existingLink.customerId !== resolution.customerId) {
      await recomputeCustomerAggregatesTx(tx, existingLink.customerId);
    }
  }

  await recomputeCustomerAggregatesTx(tx, resolution.customerId);
  return resolution;
}

export async function backfillCanonicalCustomers(input?: { limit?: number }): Promise<{ processed: number }> {
  const limit = Math.max(1, Math.min(Number(input?.limit ?? 1000), 10_000));
  const candidates = await db
    .select({
      id: orders.id,
      marketplace: orders.marketplace,
      customerExternalId: sql<string | null>`NULLIF(BTRIM(COALESCE(${orders.legacyRawPayload} ->> 'buyerUsername', '')), '')`,
      buyerName: orders.buyerName,
      buyerEmail: sql<string | null>`NULLIF(BTRIM(COALESCE(${orders.legacyRawPayload} ->> 'buyerEmail', '')), '')`,
      city: sql<string | null>`NULLIF(BTRIM(COALESCE(${orders.legacyRawPayload} -> 'shippingAddress' ->> 'city', '')), '')`,
      state: sql<string | null>`NULLIF(BTRIM(COALESCE(${orders.legacyRawPayload} -> 'shippingAddress' ->> 'stateOrProvince', '')), '')`,
      country: sql<string | null>`NULLIF(BTRIM(COALESCE(${orders.legacyRawPayload} -> 'shippingAddress' ->> 'countryCode', ${orders.buyerCountry}, '')), '')`,
      createdAt: orders.createdAt,
      totalPrice: sql<string | null>`CASE WHEN ${orders.totalPrice} IS NULL THEN NULL ELSE ${orders.totalPrice}::text END`,
      currency: orders.currency,
    })
    .from(orders)
    .leftJoin(customerOrders, eq(customerOrders.orderId, orders.id))
    .where(isNull(customerOrders.id))
    .orderBy(asc(orders.createdAt))
    .limit(limit);

  let processed = 0;
  for (const order of candidates) {
    await db.transaction(async (tx) => {
      await linkOrderToCanonicalCustomerTx(tx, {
        orderId: order.id,
        marketplace: order.marketplace,
        customerExternalId: order.customerExternalId,
        buyerName: order.buyerName,
        buyerEmail: order.buyerEmail,
        city: order.city,
        state: order.state,
        country: order.country,
        orderCreatedAt: order.createdAt,
        orderTotal: order.totalPrice,
        orderCurrency: order.currency,
      });
    });
    processed += 1;
  }

  return { processed };
}
