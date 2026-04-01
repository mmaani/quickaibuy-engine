import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDashboardAlertHref,
  buildScopedHealth,
  countAlertsBySeverity,
  deriveEvidenceState,
  deriveHealthStatus,
  deriveRenderState,
  deriveScopedHealthStatus,
  explainZeroState,
  getReadOnlyRefreshDescription,
  normalizeDashboardProductIdentity,
  normalizeDashboardSupplierKey,
  summarizeIncidents,
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

test('scoped supplier discovery health degrades when fresh rows have no viable downstream contribution', () => {
  const status = deriveScopedHealthStatus({
    domain: 'supplier_discovery',
    totalRows: 100,
    freshRows: 40,
    staleRows: 60,
    lastDataTs: '2026-04-01T00:00:00.000Z',
    lastSuccessfulRunTs: '2026-04-01T00:00:00.000Z',
    scheduleActive: true,
    viableCount: 12,
    downstreamContributionCount: 0,
  });

  assert.equal(status, 'FRESH_DEGRADED');
});

test('order sync becomes TOTAL_FAILURE on auth invalid even with recent rows', () => {
  const status = deriveScopedHealthStatus({
    domain: 'order_sync',
    totalRows: 4,
    freshRows: 4,
    staleRows: 0,
    lastDataTs: '2026-04-01T00:00:00.000Z',
    lastSuccessfulRunTs: '2026-04-01T00:00:00.000Z',
    scheduleActive: true,
    repeatedFailures: 0,
    authInvalid: true,
  });

  assert.equal(status, 'TOTAL_FAILURE');
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

test('zero-state explanation distinguishes blocked from idle', () => {
  const blocked = explainZeroState({
    state: 'ZERO_VALID',
    label: 'Ready to publish',
    blocked: true,
  });
  const idle = explainZeroState({
    state: 'ZERO_VALID',
    label: 'Ready to publish',
  });

  assert.equal(blocked.reason, 'blocked');
  assert.match(blocked.detail, /blocked/i);
  assert.equal(idle.reason, 'idle');
});

test('incident summarization deduplicates repeated current failures', () => {
  const incidents = summarizeIncidents([
    {
      id: '1',
      tone: 'error',
      title: 'Order sync auth failure',
      detail: 'invalid_grant',
      href: '/admin/orders?status=failed',
      domain: 'order_sync',
      incidentState: 'CURRENT',
      blockedReason: 'invalid_grant',
    },
    {
      id: '2',
      tone: 'error',
      title: 'Order sync auth failure',
      detail: 'invalid_grant',
      href: '/admin/orders?status=failed',
      domain: 'order_sync',
      incidentState: 'CURRENT',
      blockedReason: 'invalid_grant',
    },
  ]);

  assert.equal(incidents.length, 1);
  assert.equal(incidents[0]?.count, 2);
});

test('historical worker failure evidence stays distinct from current failing state', () => {
  assert.equal(deriveEvidenceState({ status: 'FAILED', isLatestForWorker: false }), 'HISTORICAL_RESOLVED');
  assert.equal(deriveEvidenceState({ status: 'FAILED', isLatestForWorker: true }), 'CURRENT');
});

test('buildScopedHealth marks blocked actions without making refresh executable', () => {
  const health = buildScopedHealth({
    domain: 'listing_pipeline',
    label: 'Listing pipeline',
    state: 'FRESH_DEGRADED',
    actionableHref: '/admin/listings?status=PUBLISH_FAILED',
    latestEvidenceTs: '2026-04-01T00:00:00.000Z',
    blockedReason: 'active publish failures',
  });

  assert.equal(health.actionState, 'BLOCKED');
  assert.equal(health.blockedReason, 'active publish failures');
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
  assert.equal(
    buildDashboardAlertHref({
      surface: 'orders',
      params: { status: 'failed', reason: 'auth' },
    }),
    '/admin/orders?status=failed&reason=auth'
  );
});

test('query failure rendering stays distinct from stale and zero', () => {
  const render = deriveRenderState('TOTAL_FAILURE', { queryFailed: true });
  assert.equal(render, 'QUERY_FAILED');
});
