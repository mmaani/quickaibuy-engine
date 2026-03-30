import { NextResponse } from "next/server";
import { log } from "@/lib/logger";
import { REVIEW_ACTION_STATUSES, REVIEW_ROUTE } from "@/lib/review/console";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";
import { enqueueAdminMutationJob } from "@/lib/jobs/enqueueAdminMutations";
import { JOB_NAMES } from "@/lib/jobNames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GENERIC_DECISION_ERROR = "Review decision enqueue failed. Try again, or contact support if it keeps happening.";

function unauthorizedResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "unauthorized" },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`,
        "Cache-Control": "no-store",
      },
    }
  );
}

function buildRedirectUrl(request: Request): URL {
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer);
    } catch {}
  }
  return new URL(REVIEW_ROUTE, request.url);
}

function redirectWithError(request: Request, message: string): NextResponse {
  const redirectUrl = buildRedirectUrl(request);
  redirectUrl.searchParams.set("decisionError", message);
  return NextResponse.redirect(redirectUrl, { status: 303 });
}

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return unauthorizedResponse();
  }

  try {
    const formData = await request.formData();
    const decisionStatus = String(formData.get("decisionStatus") ?? "").trim().toUpperCase();
    const reasonValue = String(formData.get("reason") ?? "").trim();
    const reason = reasonValue ? reasonValue : null;
    const actorId = getReviewActorIdFromAuthorizationHeader(authorization) ?? "review-console";

    if (!REVIEW_ACTION_STATUSES.includes(decisionStatus as (typeof REVIEW_ACTION_STATUSES)[number])) {
      return redirectWithError(request, "Choose Approve, Reject, or Mark for Recheck before submitting.");
    }

    const redirectUrl = buildRedirectUrl(request);
    const batchCandidateIds = formData.getAll("candidateIds").map((value) => String(value).trim()).filter(Boolean);

    if (batchCandidateIds.length > 0) {
      const uniqueCandidateIds = Array.from(new Set(batchCandidateIds));
      const job = await enqueueAdminMutationJob({
        jobName: JOB_NAMES.ADMIN_REVIEW_DECISION,
        actorId,
        triggerSource: "review-console",
        controlPath: "api/admin/review/decision",
        actionType: "candidate_review_decision_batch",
        payload: {
          decisionStatus,
          reason,
          candidateIds: uniqueCandidateIds,
          enforceBatchSafeApprove: decisionStatus === "APPROVED",
        },
        idempotencySuffix: `batch-${Date.now()}`,
      });

      redirectUrl.searchParams.set("batchQueued", "1");
      redirectUrl.searchParams.set("batchAction", decisionStatus);
      redirectUrl.searchParams.set("batchCount", String(uniqueCandidateIds.length));
      redirectUrl.searchParams.set("jobId", String(job.id));
      return NextResponse.redirect(redirectUrl, { status: 303 });
    }

    const candidateId = String(formData.get("candidateId") ?? "").trim();
    if (!candidateId) return redirectWithError(request, "Candidate ID is required for a review decision.");

    const job = await enqueueAdminMutationJob({
      jobName: JOB_NAMES.ADMIN_REVIEW_DECISION,
      actorId,
      triggerSource: "review-console",
      controlPath: "api/admin/review/decision",
      actionType: "candidate_review_decision_single",
      payload: {
        decisionStatus,
        reason,
        candidateIds: [candidateId],
        enforceBatchSafeApprove: false,
      },
      idempotencySuffix: `single-${candidateId}-${Date.now()}`,
    });

    redirectUrl.searchParams.set("decisionQueued", "1");
    redirectUrl.searchParams.set("decisionStatus", decisionStatus);
    redirectUrl.searchParams.set("candidateId", candidateId);
    redirectUrl.searchParams.set("jobId", String(job.id));
    return NextResponse.redirect(redirectUrl, { status: 303 });
  } catch (error) {
    log("error", "review.decision.enqueue.failed", {
      error: error instanceof Error ? error.message : String(error),
      path: new URL(request.url).pathname,
    });
    return redirectWithError(request, GENERIC_DECISION_ERROR);
  }
}
