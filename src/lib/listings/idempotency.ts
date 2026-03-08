export function buildListingPreviewIdempotencyKey(input: {
  candidateId: string;
  marketplaceKey: string;
  version?: string;
}) {
  const version = input.version ?? "v1";
  return `listing-readiness:${version}:${input.marketplaceKey}:${input.candidateId}`;
}
