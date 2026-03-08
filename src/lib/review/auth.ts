import type { NextRequest } from "next/server";

export const REVIEW_CONSOLE_REALM = "QuickAIBuy Review";

export function getReviewConsoleCredentials() {
  const username = process.env.REVIEW_CONSOLE_USERNAME?.trim() ?? "";
  const password = process.env.REVIEW_CONSOLE_PASSWORD ?? "";

  if (!username || !password) {
    return null;
  }

  return { username, password };
}

export function isReviewConsoleConfigured(): boolean {
  return getReviewConsoleCredentials() !== null;
}

function decodeBasicAuthHeader(value: string | null): { username: string; password: string } | null {
  if (!value?.startsWith("Basic ")) {
    return null;
  }

  try {
    const token = value.slice(6);
    const decoded =
      typeof Buffer !== "undefined" ? Buffer.from(token, "base64").toString("utf8") : atob(token);
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex < 0) return null;

    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export function isAuthorizedReviewRequest(request: NextRequest): boolean {
  const configured = getReviewConsoleCredentials();
  if (!configured) return false;

  const parsed = decodeBasicAuthHeader(request.headers.get("authorization"));
  if (!parsed) return false;

  return parsed.username === configured.username && parsed.password === configured.password;
}

export function isAuthorizedReviewAuthorizationHeader(value: string | null): boolean {
  const configured = getReviewConsoleCredentials();
  if (!configured) return false;

  const parsed = decodeBasicAuthHeader(value);
  if (!parsed) return false;

  return parsed.username === configured.username && parsed.password === configured.password;
}

export function getReviewActorIdFromAuthorizationHeader(value: string | null): string | null {
  const parsed = decodeBasicAuthHeader(value);
  return parsed?.username?.trim() ? parsed.username.trim() : null;
}
