# Supplier Account And Payment Safety

## Active suppliers for fulfillment

The current codebase shows one supplier integrated for fulfillment operations:

| Supplier | Fulfillment status | Evidence in code |
|---|---|---|
| CJ Dropshipping (`cjdropshipping`) | Active | Auto-purchase and supplier tracking are wired through `src/lib/orders/autoPurchase.ts`, `src/lib/orders/manualPurchaseFlow.ts`, `src/lib/suppliers/cjApi.ts`, and `src/lib/suppliers/cjTracking.ts`. |

The following suppliers are present for sourcing or discovery, but are not currently wired as active fulfillment providers:

| Supplier | Current role | Evidence in code |
|---|---|---|
| AliExpress | Discovery / sourcing only | `src/lib/jobs/supplierDiscover.ts`, `src/lib/products/suppliers/aliexpress.ts` |
| Alibaba | Discovery / sourcing only | `src/lib/jobs/supplierDiscover.ts`, `src/lib/products/suppliers/alibaba.ts` |
| Temu | Discovery / sourcing only | `src/lib/jobs/supplierDiscover.ts`, `src/lib/products/suppliers/temu.ts` |

## Operational checklist

### CJ Dropshipping

- Account created: `TBD`
- API-connected store verification: `NOT VERIFIED`
  Portal warning observed: `This API-connected store is not yet verified. Please contact the CJ team via online chat with your API usage details to activate the store.`
- Business verification complete: `TBD`
- Payment method configured on supplier site: `TBD`
  Only store a descriptor such as `corporate card label` or `PayPal Business`; never store raw payment details here.
- Test order completed: `TBD`
- Refund/dispute process known: `TBD`
- Transaction alerts monitored: `TBD`
- Operational owner: `TBD`
- Integration constraint: public CJ docs state unverified users are capped at `1,000 calls/day per interface` and the lowest access tier is limited to `1 request/second`.
- Secret-handling note: treat the CJ API key as sensitive and never copy it into commits, docs, tickets, or logs.

### AliExpress

- Account created: `Yes`
- Account owner: `quickaibuy@gmail.com`
- Business verification complete: `TBD`
- Payment method configured on supplier site: `TBD`
  Only store a descriptor such as `corporate card label` or `PayPal Business`; never store raw payment details here.
- Test order completed: `TBD`
- Refund/dispute process known: `TBD`
- Transaction alerts monitored: `TBD`
- Operational owner: `TBD`
- Current sourcing note: AliExpress remains discovery-only and still fails closed when deterministic ship-from-country evidence is missing.

### Alibaba

- Account created: `Yes`
- Account owner: `quickaibuy@gmail.com`
- Business verification complete: `TBD`
- Payment method configured on supplier site: `TBD`
  Only store a descriptor such as `corporate card label` or `PayPal Business`; never store raw payment details here.
- Test order completed: `TBD`
- Refund/dispute process known: `TBD`
- Transaction alerts monitored: `TBD`
- Operational owner: `TBD`

### Temu

- Account created: `Yes`
- Account owner: `quickaibuy@gmail.com`
- Business verification complete: `TBD`
- Payment method configured on supplier site: `TBD`
  Only store a descriptor such as `corporate card label` or `PayPal Business`; never store raw payment details here.
- Test order completed: `TBD`
- Refund/dispute process known: `TBD`
- Transaction alerts monitored: `TBD`
- Operational owner: `TBD`

## Ownership and monitoring record

Use this section for operational metadata only:

- Active supplier account: `CJ Dropshipping`
- Account owner: `TBD`
- Discovery-only supplier accounts: `AliExpress`, `Alibaba`, `Temu`
- Discovery-only supplier account owner: `quickaibuy@gmail.com`
- Payment method descriptor: `TBD`
  Example of acceptable detail: `Finance-issued virtual card label` or `PayPal Business`.
  Example of forbidden detail: full card number, expiry, security code, or billing address secrets.
- Transaction alert destination: `TBD`
- Escalation contact: `TBD`

## Current operator guidance

- Do not route new candidate effort into CJ just because the supplier is fulfillment-capable; current CJ candidate economics remain blocked.
- Prefer discovery-only, non-electronics candidates when they have stronger marketplace fit, but keep AliExpress fail-closed until ship-from-country becomes deterministic.
- Current leading discovery-only candidate family is donut-lamp / ambient-light style home decor, not electronics.

## Non-goals

- Do not store raw card details in the repo.
- Do not put payment credentials in `.env*`.
- Do not automate browser payment entry through scripts or Codex.
