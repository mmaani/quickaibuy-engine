import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { REVIEW_CONSOLE_REALM, getReviewConsoleCredentials, isAuthorizedReviewRequest } from "@/lib/review/auth";

function unauthorizedResponse(): NextResponse {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REVIEW_CONSOLE_REALM}"`,
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const configured = getReviewConsoleCredentials();

  if (!configured) {
    return new NextResponse("Missing REVIEW_CONSOLE_USERNAME or REVIEW_CONSOLE_PASSWORD", {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  }

  if (!isAuthorizedReviewRequest(request)) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/admin/review/:path*",
    "/admin/control/:path*",
    "/admin/orders/:path*",
    "/api/admin/review/:path*",
    "/api/admin/pipeline/:path*",
    "/api/ops/:path*",
  ],
};
