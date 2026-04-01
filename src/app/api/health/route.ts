import { NextResponse } from "next/server";
import postgres from "postgres";
import Redis from "ioredis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_WHATSAPP_NUMBER = "962791752686";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trimOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function getContactNotificationRuntime() {
  const emailTo =
    trimOrNull(process.env.LEAD_NOTIFICATION_EMAIL_TO) ??
    trimOrNull(process.env.CONTACT_NOTIFICATION_EMAIL_TO);
  const emailWebhookUrl = trimOrNull(process.env.LEAD_EMAIL_WEBHOOK_URL);
  const resendApiKey = trimOrNull(process.env.RESEND_API_KEY);
  const whatsappWebhookUrl = trimOrNull(process.env.LEAD_WHATSAPP_WEBHOOK_URL);
  const twilioSid = trimOrNull(process.env.TWILIO_ACCOUNT_SID);
  const whatsappEnvTarget =
    trimOrNull(process.env.TWILIO_WHATSAPP_TO) ??
    trimOrNull(process.env.LEAD_NOTIFICATION_WHATSAPP_TO) ??
    trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER);
  const manualWhatsappTarget = trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER) ?? DEFAULT_WHATSAPP_NUMBER;

  return {
    primaryChannel: "whatsapp",
    email: {
      mode: resendApiKey ? "resend" : emailWebhookUrl ? "webhook" : "none",
      hasResendApiKey: Boolean(resendApiKey),
      hasWebhookUrl: Boolean(emailWebhookUrl),
      hasRecipient: Boolean(emailTo),
      ready: Boolean(emailTo && (resendApiKey || emailWebhookUrl)),
      optional: true,
    },
    whatsapp: {
      mode: twilioSid ? "twilio" : whatsappWebhookUrl ? "webhook" : "manual_link",
      hasTwilioAccountSid: Boolean(twilioSid),
      hasWebhookUrl: Boolean(whatsappWebhookUrl),
      hasRecipient: Boolean(whatsappEnvTarget),
      hasManualTarget: Boolean(manualWhatsappTarget),
      usingDefaultManualTarget: !trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER),
      automatedReady: Boolean(whatsappEnvTarget && (twilioSid || whatsappWebhookUrl)),
      manualReady: Boolean(manualWhatsappTarget),
      primaryReady: Boolean(manualWhatsappTarget),
    },
  };
}

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b(EAI_AGAIN|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH)\b/i.test(message);
}

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 500): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) {
        throw error;
      }
      await sleep(baseDelayMs * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Transient retry failed"));
}

export async function GET() {
  const started = Date.now();

  let db = false;
  let redis = false;
  let dbDetail: string | null = null;
  let redisDetail: string | null = null;

  try {
    const dbUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_DIRECT;
    if (!dbUrl) throw new Error("Missing DATABASE_URL or DATABASE_URL_DIRECT");
    await withTransientRetry(async () => {
      const sql = postgres(dbUrl, { max: 1, idle_timeout: 2, connect_timeout: 5 });
      try {
        await sql`SELECT 1`;
      } finally {
        await sql.end({ timeout: 2 });
      }
    });
    db = true;
  } catch (error) {
    db = false;
    dbDetail = error instanceof Error ? error.message : String(error);
  }

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) throw new Error("Missing REDIS_URL");
    const pong = await withTransientRetry(async () => {
      const client = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableReadyCheck: false, lazyConnect: true });
      try {
        await client.connect();
        return await client.ping();
      } finally {
        await client.quit().catch(() => client.disconnect());
      }
    });
    redis = pong === "PONG";
  } catch (error) {
    redis = false;
    redisDetail = error instanceof Error ? error.message : String(error);
  }

  return NextResponse.json({
    ok: db && redis,
    db,
    redis,
    dbDetail,
    redisDetail,
    contactNotifications: getContactNotificationRuntime(),
    ms: Date.now() - started,
    env: process.env.NODE_ENV ?? "unknown",
  });
}
