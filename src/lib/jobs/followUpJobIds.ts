function normalizeJobIdPart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function buildFollowUpJobId(input: {
  jobName: string;
  sourceJobId: string;
  productRawId?: string;
  limit?: number;
}): string {
  const jobName = normalizeJobIdPart(String(input.jobName ?? "")) || "job";
  const sourceJobId = normalizeJobIdPart(String(input.sourceJobId ?? "")) || "source";
  const productRawId = normalizeJobIdPart(String(input.productRawId ?? ""));
  const limit = Math.max(0, Number(input.limit ?? 0));

  if (productRawId) {
    return `${jobName}-${productRawId}`;
  }

  return `${jobName}-from-${sourceJobId}-limit-${limit}`;
}
