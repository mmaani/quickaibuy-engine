import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDashboardAlertHref,
  countAlertsBySeverity,
  deriveHealthStatus,
  deriveRenderState,
  getReadOnlyRefreshDescription,
  normalizeDashboardProductIdentity,
  normalizeDashboardSupplierKey,
} from '@/lib/dashboard/status';

test('contradictory fresh coverage with missing worker evidence resolves to PARTIAL_FAILURE', () => {
  const status = deriveHealthStatus({
    totalRows: 10,
    freshRows: 10,
    staleRows: 0,
    lastDataTs: '2026-04-01T00:00:00.000Z',
    lastSuccessfulRunTs: null,
    scheduleActive: true,
  });

  assert.equal(status, 'PARTIAL_FAILURE');
});

test('latest row exists but zero fresh rows remains STALE', () => {
  const status = deriveHealthStatus({
    totalRows: 12,
    freshRows: 0,
    staleRows: 12,
    lastDataTs: '2026-04-01T00:00:00.000Z',
    lastSuccessfulRunTs: '2026-04-01T00:00:00.000Z',
    scheduleActive: true,
  });

  assert.equal(status, 'STALE');
});

test('supplier normalization collapses CJ aliases into one product identity', () => {
  assert.equal(normalizeDashboardSupplierKey('CJ'), 'cjdropshipping');
  assert.equal(normalizeDashboardSupplierKey('CJdropshipping'), 'cjdropshipping');
  assert.equal(normalizeDashboardSupplierKey('cj dropshipping'), 'cjdropshipping');
  assert.equal(
    normalizeDashboardProductIdentity({
      supplierKey: 'CJdropshipping',
      supplierProductId: 'SKU-1',
      marketplaceKey: 'eBay-US',
      marketplaceListingId: 'ABC',
    }),
    normalizeDashboardProductIdentity({
      supplierKey: 'cj dropshipping',
      supplierProductId: 'sku-1',
      marketplaceKey: 'ebay',
      marketplaceListingId: 'abc',
    })
  );
});

test('alert count severity stays deterministic', () => {
  const counts = countAlertsBySeverity([
    { id: 'a', tone: 'error', title: 'A', detail: 'A', href: '/admin/control' },
    { id: 'b', tone: 'warning', title: 'B', detail: 'B', href: '/admin/review' },
    { id: 'c', tone: 'error', title: 'C', detail: 'C', href: '/admin/listings' },
  ]);

  assert.deepEqual(counts, { info: 0, warning: 1, error: 2 });
});

test('refresh behavior remains strictly read-only', () => {
  const behavior = getReadOnlyRefreshDescription();

  assert.equal(behavior.pageCaching, 'force-dynamic');
  assert.equal(behavior.readOnly, true);
  assert.match(behavior.refreshAction, /never enqueues jobs or mutates state/i);
});

test('deep-link generation preserves exact filters', () => {
  assert.equal(
    buildDashboardAlertHref({
      surface: 'review',
      params: { reason: 'shipping_block', supplier: 'cj', marketplace: 'ebay' },
    }),
    '/admin/review?reason=shipping_block&supplier=cj&marketplace=ebay'
  );
});

test('query failure rendering stays distinct from stale and zero', () => {
  const render = deriveRenderState('TOTAL_FAILURE', { queryFailed: true });
  assert.equal(render, 'QUERY_FAILED');
});
