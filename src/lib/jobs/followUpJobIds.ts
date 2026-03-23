export function buildFollowUpJobId(input: {
  jobName: string;
  sourceJobId: string;
  productRawId?: string;
  limit?: number;
}): string {
  const productRawId = String(input.productRawId ?? "").trim();
  if (productRawId) {
    return `${input.jobName}:${productRawId}`;
  }

  return `${input.jobName}:from:${input.sourceJobId}:limit:${Number(input.limit ?? 0)}`;
}
