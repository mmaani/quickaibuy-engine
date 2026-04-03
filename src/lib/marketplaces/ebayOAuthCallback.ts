import "server-only";

import fs from "node:fs";
import path from "node:path";
import { loadRuntimeEnv } from "@/lib/runtimeEnv";

const EBAY_PRODUCTION_TOKEN_URL = "https://api.ebay.com/identity/v1/oauth2/token";
const EBAY_RUNAME = "Mohammad_Maani-Mohammad-QuickA-qehtnbwbq";
const VERCEL_API_ROOT = "https://api.vercel.com";
const VERCEL_PROJECT_FILE = path.join(process.cwd(), ".vercel", "project.json");

type CallbackFailureCode =
  | "missing_code"
  | "missing_ebay_credentials"
  | "missing_vercel_credentials"
  | "missing_vercel_project_link"
  | "token_exchange_failed"
  | "token_exchange_malformed"
  | "token_persist_failed";

type CallbackFailure = {
  ok: false;
  code: CallbackFailureCode;
  title: string;
  detail: string;
  operatorAction: string;
  exchangeErrorCode?: string | null;
};

type CallbackSuccess = {
  ok: true;
  title: string;
  detail: string;
  operatorAction: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresIn: number | null;
  persistedTarget: "production";
};

export type EbayOAuthCallbackResult = CallbackFailure | CallbackSuccess;

type VercelProjectLink = {
  projectId: string;
  orgId: string | null;
};

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJsonRecord(input: string): Record<string, unknown> {
  if (!input.trim()) return {};
  try {
    const parsed = JSON.parse(input) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { raw: parsed };
  } catch {
    return { raw: input };
  }
}

function logInfo(message: string, detail: Record<string, unknown>) {
  console.info("[ebay-oauth-callback]", message, detail);
}

function logError(message: string, detail: Record<string, unknown>) {
  console.error("[ebay-oauth-callback]", message, detail);
}

function getVercelCredential(): string | null {
  return (
    stringOrNull(process.env.VERCEL_ACCESS_TOKEN) ||
    stringOrNull(process.env.VERCEL_TOKEN) ||
    stringOrNull(process.env.VERCEL_OIDC_TOKEN)
  );
}

function readVercelProjectLink(): VercelProjectLink | null {
  try {
    if (!fs.existsSync(VERCEL_PROJECT_FILE)) return null;
    const parsed = JSON.parse(fs.readFileSync(VERCEL_PROJECT_FILE, "utf8")) as Record<string, unknown>;
    const projectId = stringOrNull(parsed.projectId);
    const orgId = stringOrNull(parsed.orgId);
    if (!projectId) return null;
    return { projectId, orgId };
  } catch {
    return null;
  }
}

function buildVercelUrl(pathname: string, teamId: string | null, searchParams?: Record<string, string>): URL {
  const url = new URL(pathname, VERCEL_API_ROOT);
  if (teamId) {
    url.searchParams.set("teamId", teamId);
  }
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

async function parseVercelError(response: Response): Promise<string> {
  const text = await response.text();
  const body = parseJsonRecord(text);
  const errorBlock =
    body.error && typeof body.error === "object" && !Array.isArray(body.error)
      ? (body.error as Record<string, unknown>)
      : null;
  return (
    stringOrNull(errorBlock?.message) ||
    stringOrNull(errorBlock?.code) ||
    stringOrNull(body.message) ||
    stringOrNull(typeof body.error === "string" ? body.error : null) ||
    `Vercel API request failed with status ${response.status}`
  );
}

async function persistRefreshTokenToVercelProduction(refreshToken: string): Promise<void> {
  const credential = getVercelCredential();
  if (!credential) {
    throw new Error("Missing Vercel server credential. Set VERCEL_ACCESS_TOKEN, VERCEL_TOKEN, or VERCEL_OIDC_TOKEN.");
  }

  const projectLink = readVercelProjectLink();
  if (!projectLink) {
    throw new Error("Missing .vercel/project.json project link for production secret persistence.");
  }

  const payload = {
    key: "EBAY_REFRESH_TOKEN",
    value: refreshToken,
    type: "encrypted",
    target: ["production"],
  };

  const candidateBodies = [JSON.stringify([payload]), JSON.stringify(payload)];
  let lastError = "Unknown Vercel env persistence failure.";

  for (const body of candidateBodies) {
    const url = buildVercelUrl(`/v10/projects/${projectLink.projectId}/env`, projectLink.orgId, {
      upsert: "true",
    });
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credential}`,
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });

    if (response.ok) {
      logInfo("refresh_token_persisted", {
        target: "production",
        projectId: projectLink.projectId,
      });
      return;
    }

    lastError = await parseVercelError(response);
  }

  throw new Error(lastError);
}

async function exchangeAuthorizationCode(code: string): Promise<EbayOAuthCallbackResult> {
  loadRuntimeEnv();

  const clientId = stringOrNull(process.env.EBAY_CLIENT_ID);
  const clientSecret = stringOrNull(process.env.EBAY_CLIENT_SECRET);

  if (!clientId || !clientSecret) {
    logError("missing_ebay_credentials", {
      hasClientId: Boolean(clientId),
      hasClientSecret: Boolean(clientSecret),
    });
    return {
      ok: false,
      code: "missing_ebay_credentials",
      title: "eBay OAuth exchange is not configured",
      detail: "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET in the server runtime.",
      operatorAction: "Set the production eBay app credentials in the server runtime and retry the consent flow.",
    };
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const response = await fetch(EBAY_PRODUCTION_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: EBAY_RUNAME,
    }),
    cache: "no-store",
  });

  const text = await response.text();
  const body = parseJsonRecord(text);
  const exchangeErrorCode = stringOrNull(body.error);
  const exchangeErrorDescription = stringOrNull(body.error_description);

  if (!response.ok) {
    logError("token_exchange_failed", {
      status: response.status,
      exchangeErrorCode,
      exchangeErrorDescription,
      hasCode: true,
      runame: EBAY_RUNAME,
    });

    return {
      ok: false,
      code: "token_exchange_failed",
      title: "eBay token exchange failed",
      detail:
        exchangeErrorDescription ||
        exchangeErrorCode ||
        `eBay token exchange failed with status ${response.status}.`,
      operatorAction:
        exchangeErrorCode === "invalid_client"
          ? "Verify EBAY_CLIENT_ID and EBAY_CLIENT_SECRET for the production eBay app, then retry consent."
          : exchangeErrorCode === "invalid_grant"
            ? "The authorization code is expired, already used, or mismatched to this app. Restart the eBay consent flow and retry."
            : "Inspect the server logs for the returned eBay error and retry the consent flow once configuration is confirmed.",
      exchangeErrorCode,
    };
  }

  const accessToken = stringOrNull(body.access_token);
  const refreshToken = stringOrNull(body.refresh_token);
  const expiresIn = Number(body.expires_in);
  const rawRefreshTokenExpiresIn = body.refresh_token_expires_in;
  const refreshTokenExpiresIn =
    rawRefreshTokenExpiresIn === undefined || rawRefreshTokenExpiresIn === null
      ? null
      : Number(rawRefreshTokenExpiresIn);

  if (
    !accessToken ||
    !refreshToken ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0 ||
    (refreshTokenExpiresIn !== null && !Number.isFinite(refreshTokenExpiresIn))
  ) {
    logError("token_exchange_malformed", {
      hasAccessToken: Boolean(accessToken),
      hasRefreshToken: Boolean(refreshToken),
      expiresIn,
      refreshTokenExpiresIn,
    });
    return {
      ok: false,
      code: "token_exchange_malformed",
      title: "eBay token exchange returned an invalid payload",
      detail: "The production token endpoint did not return a valid access_token, refresh_token, and expires_in.",
      operatorAction: "Inspect the server logs for the malformed token response and retry only after the payload shape is understood.",
    };
  }

  try {
    await persistRefreshTokenToVercelProduction(refreshToken);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const lower = message.toLowerCase();
    const missingCredential = lower.includes("credential");
    const missingProjectLink = lower.includes("project link");
    logError("token_persist_failed", {
      reason: message,
      target: "production",
      refreshTokenLength: refreshToken.length,
    });
    return {
      ok: false,
      code: missingCredential
        ? "missing_vercel_credentials"
        : missingProjectLink
          ? "missing_vercel_project_link"
          : "token_persist_failed",
      title: "eBay token exchange succeeded but refresh-token persistence failed",
      detail: message,
      operatorAction:
        missingCredential
          ? "Provide a server-side Vercel credential that can update production env, then rerun the consent flow."
          : missingProjectLink
            ? "Link this deployment to the correct Vercel project and rerun the consent flow."
            : "Inspect the Vercel env persistence failure in the server logs and retry after the production secret store is writable.",
    };
  }

  logInfo("token_exchange_and_persist_succeeded", {
    accessTokenExpiresIn: expiresIn,
    refreshTokenExpiresIn,
    persistedTarget: "production",
  });

  return {
    ok: true,
    title: "eBay authorization completed",
    detail: "The authorization code was exchanged at the production eBay token endpoint and the refresh token was stored in the production server secret store.",
    operatorAction: "Redeploy or restart any runtime that reads EBAY_REFRESH_TOKEN from production env before running guarded eBay flows.",
    accessTokenExpiresIn: expiresIn,
    refreshTokenExpiresIn,
    persistedTarget: "production",
  };
}

export async function handleEbayOAuthCallback(code: string | null): Promise<EbayOAuthCallbackResult> {
  if (!code) {
    logError("missing_code", {
      hasCode: false,
      runame: EBAY_RUNAME,
    });
    return {
      ok: false,
      code: "missing_code",
      title: "No eBay authorization code was returned",
      detail: "The callback query string did not include a code parameter.",
      operatorAction: "Restart the eBay consent flow and confirm the production callback URL resolves to this page with the full query string intact.",
    };
  }

  return exchangeAuthorizationCode(code);
}
