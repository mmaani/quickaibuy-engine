import { NextResponse } from "next/server";
import {
  REVIEW_CONSOLE_REALM,
  getReviewActorIdFromAuthorizationHeader,
  isAuthorizedReviewAuthorizationHeader,
  isReviewConsoleConfigured,
} from "@/lib/review/auth";

export type PipelineAdminAuth =
  | {
      ok: true;
      actorId: string | null;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export function requirePipelineAdmin(request: Request): PipelineAdminAuth {
  const authorization = request.headers.get("authorization");

  if (!isReviewConsoleConfigured() || !isAuthorizedReviewAuthorizationHeader(authorization)) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          error: "unauthorized",
        },
        {
          status: 401,
          headers: {
            "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`,
            "Cache-Control": "no-store",
          },
        }
      ),
    };
  }

  return {
    ok: true,
    actorId: getReviewActorIdFromAuthorizationHeader(authorization),
  };
}
