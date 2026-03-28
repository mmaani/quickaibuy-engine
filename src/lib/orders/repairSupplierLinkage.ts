import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { listings, orderItems } from "@/lib/db/schema";
import { createOrderEvent } from "./orderEvents";

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function repairOrderItemSupplierLinkage(input: {
  orderId: string;
  orderItemId: string;
  supplierKey?: string | null;
  supplierProductId?: string | null;
  supplierSourceUrl?: string | null;
  listingId?: string | null;
  actorId?: string | null;
}) {
  const orderId = clean(input.orderId);
  const orderItemId = clean(input.orderItemId);
  const supplierKey = clean(input.supplierKey);
  const supplierProductId = clean(input.supplierProductId);
  const supplierSourceUrl = clean(input.supplierSourceUrl);
  const listingId = clean(input.listingId);

  if (!orderId) throw new Error("Order id is required.");
  if (!orderItemId) throw new Error("Order item id is required.");
  if (!listingId && (!supplierKey || !supplierProductId)) {
    throw new Error("Provide an exact listing id or both supplier key and supplier product id.");
  }

  const targetRows = await db
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      listingId: orderItems.listingId,
    })
    .from(orderItems)
    .where(and(eq(orderItems.id, orderItemId), eq(orderItems.orderId, orderId)))
    .limit(1);

  const target = targetRows[0];
  if (!target) {
    throw new Error("Order item not found for this order.");
  }

  let resolvedSupplierKey = supplierKey;
  let resolvedSupplierProductId = supplierProductId;

  if (listingId) {
    const listingRows = await db
      .select({
        id: listings.id,
        marketplaceKey: listings.marketplaceKey,
        payload: listings.payload,
      })
      .from(listings)
      .where(eq(listings.id, listingId))
      .limit(1);

    const listing = listingRows[0];
    if (!listing) {
      throw new Error("Listing not found.");
    }
    if (String(listing.marketplaceKey || "").toLowerCase() !== "ebay") {
      throw new Error("Only eBay listings can be linked from this console.");
    }

    const source =
      listing.payload && typeof listing.payload === "object" && !Array.isArray(listing.payload)
        ? ((listing.payload as Record<string, unknown>).source as Record<string, unknown> | undefined)
        : undefined;
    const listingSupplierKey = clean(typeof source?.supplierKey === "string" ? source.supplierKey : null);
    const listingSupplierProductId = clean(
      typeof source?.supplierProductId === "string" ? source.supplierProductId : null
    );

    if (listingSupplierKey && supplierKey && listingSupplierKey !== supplierKey) {
      throw new Error("Listing supplier key does not match the requested supplier key.");
    }
    if (listingSupplierProductId && supplierProductId && listingSupplierProductId !== supplierProductId) {
      throw new Error("Listing supplier product id does not match the requested supplier product id.");
    }

    resolvedSupplierKey = listingSupplierKey ?? resolvedSupplierKey;
    resolvedSupplierProductId = listingSupplierProductId ?? resolvedSupplierProductId;
  }

  if (!resolvedSupplierKey || !resolvedSupplierProductId) {
    throw new Error("Resolved supplier linkage is incomplete for this order item.");
  }

  const updated = await db
    .update(orderItems)
    .set({
      listingId: listingId ?? target.listingId ?? null,
      supplierKey: resolvedSupplierKey,
      supplierProductId: resolvedSupplierProductId,
      linkageSource: "verified_repair",
      linkageVerifiedAt: new Date(),
      linkageDeterministic: true,
      supplierLinkLocked: true,
      stockCheckRequired: true,
    })
    .where(eq(orderItems.id, orderItemId))
    .returning({
      id: orderItems.id,
      orderId: orderItems.orderId,
      listingId: orderItems.listingId,
      supplierKey: orderItems.supplierKey,
      supplierProductId: orderItems.supplierProductId,
      linkageSource: orderItems.linkageSource,
      linkageVerifiedAt: orderItems.linkageVerifiedAt,
      linkageDeterministic: orderItems.linkageDeterministic,
      supplierLinkLocked: orderItems.supplierLinkLocked,
    });

  const row = updated[0];

  await createOrderEvent({
    orderId,
    eventType: "MANUAL_NOTE",
    details: {
      action: "MANUAL_SUPPLIER_LINKAGE_REPAIRED",
      actorId: clean(input.actorId) ?? null,
      orderItemId,
      listingIdRetained: row?.listingId ?? null,
      supplierKey: resolvedSupplierKey,
      supplierProductId: resolvedSupplierProductId,
      supplierSourceUrl,
      linkageSource: "verified_repair",
      linkageDeterministic: true,
      supplierLinkLocked: true,
      requiresListingReapproval: true,
    },
  });

  return row;
}
