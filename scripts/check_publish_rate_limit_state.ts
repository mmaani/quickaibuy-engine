import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

async function main() {
  const { getPublishRateLimitState, getPublishRateLimitConfig } = await import(
    "@/lib/listings/publishRateLimiter"
  );

  const limits = getPublishRateLimitConfig();
  const state = await getPublishRateLimitState("ebay");

  console.log("Publish rate limiter config:");
  console.table({
    limit15m: limits.limit15m,
    limit1h: limits.limit1h,
    limit1d: limits.limit1d,
  });

  console.log("Current publish attempt counts:");
  console.table({
    attempts15m: state.counts.attempts15m,
    attempts1h: state.counts.attempts1h,
    attempts1d: state.counts.attempts1d,
  });

  console.log("Would publish be allowed now?");
  console.table({
    allowed: state.allowed,
    blockingWindow: state.blockingWindow,
    retryHint: state.retryHint ?? "",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
