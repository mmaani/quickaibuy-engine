type LeadSubmissionRecord = {
  id: string;
  fullName: string;
  company: string | null;
  email: string;
  interest: string;
  message: string;
  sourcePage: string;
  status: string;
  createdAt: string;
};

export type NotificationResult = {
  status: "sent" | "failed" | "skipped";
  error?: string | null;
};

const DEFAULT_WHATSAPP_NUMBER = "962791752686";

function trimOrNull(value: string | null | undefined): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function buildNotificationBody(submission: LeadSubmissionRecord): string {
  return [
    "New QuickAIBuy lead submission",
    `Lead ID: ${submission.id}`,
    `Submitted: ${submission.createdAt}`,
    `Name: ${submission.fullName}`,
    `Company: ${submission.company || "-"}`,
    `Email: ${submission.email}`,
    `Interest: ${submission.interest}`,
    `Source page: ${submission.sourcePage}`,
    `Status: ${submission.status}`,
    `Message: ${submission.message}`,
  ].join("\n");
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(trimOrNull(process.env.LEAD_NOTIFICATION_WEBHOOK_TOKEN)
        ? { authorization: `Bearer ${trimOrNull(process.env.LEAD_NOTIFICATION_WEBHOOK_TOKEN)}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `notification webhook failed with ${response.status}`);
  }
}

async function postResendEmail(input: {
  to: string;
  subject: string;
  text: string;
}): Promise<void> {
  const apiKey = trimOrNull(process.env.RESEND_API_KEY);
  if (!apiKey) {
    throw new Error("RESEND_API_KEY missing");
  }

  const from =
    trimOrNull(process.env.LEAD_NOTIFICATION_EMAIL_FROM) ??
    trimOrNull(process.env.RESEND_FROM_EMAIL) ??
    "QuickAIBuy <noreply@quickaibuy.com>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      text: input.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Resend email failed with ${response.status}`);
  }
}

async function postTwilioWhatsapp(input: {
  to: string;
  body: string;
}): Promise<void> {
  const accountSid = trimOrNull(process.env.TWILIO_ACCOUNT_SID);
  const authToken = trimOrNull(process.env.TWILIO_AUTH_TOKEN);
  const from = trimOrNull(process.env.TWILIO_WHATSAPP_FROM);
  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio WhatsApp credentials missing");
  }

  const target = input.to.startsWith("whatsapp:") ? input.to : `whatsapp:${input.to}`;
  const form = new URLSearchParams({
    From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    To: target,
    Body: input.body,
  });

  const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Twilio WhatsApp failed with ${response.status}`);
  }
}

export function buildManualWhatsappUrl(submission: Omit<LeadSubmissionRecord, "id" | "status" | "createdAt"> & {
  id?: string;
  status?: string;
  createdAt?: string;
}): string {
  const phone = trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER) ?? DEFAULT_WHATSAPP_NUMBER;
  const body = buildNotificationBody({
    id: submission.id ?? "pending-id",
    fullName: submission.fullName,
    company: submission.company ?? null,
    email: submission.email,
    interest: submission.interest,
    message: submission.message,
    sourcePage: submission.sourcePage,
    status: submission.status ?? "NEW",
    createdAt: submission.createdAt ?? new Date().toISOString(),
  });

  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
}

export async function sendLeadEmailNotification(
  submission: LeadSubmissionRecord
): Promise<NotificationResult> {
  const emailTo =
    trimOrNull(process.env.LEAD_NOTIFICATION_EMAIL_TO) ??
    trimOrNull(process.env.CONTACT_NOTIFICATION_EMAIL_TO);
  const webhookUrl = trimOrNull(process.env.LEAD_EMAIL_WEBHOOK_URL);
  const resendApiKey = trimOrNull(process.env.RESEND_API_KEY);
  if (!webhookUrl && !resendApiKey) return { status: "skipped" };
  if (!emailTo) return { status: "failed", error: "lead notification email recipient missing" };

  try {
    if (resendApiKey) {
      await postResendEmail({
        to: emailTo,
        subject: `New QuickAIBuy lead: ${submission.fullName}`,
        text: buildNotificationBody(submission),
      });
    } else if (webhookUrl) {
      await postJson(webhookUrl, {
        event: "lead_submission.created",
        channel: "email",
        to: emailTo,
        subject: `New QuickAIBuy lead: ${submission.fullName}`,
        text: buildNotificationBody(submission),
        submission,
      });
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "email notification failed",
    };
  }
}

export async function sendLeadWhatsappNotification(
  submission: LeadSubmissionRecord
): Promise<NotificationResult> {
  const webhookUrl = trimOrNull(process.env.LEAD_WHATSAPP_WEBHOOK_URL);
  const twilioSid = trimOrNull(process.env.TWILIO_ACCOUNT_SID);
  const whatsappTo =
    trimOrNull(process.env.TWILIO_WHATSAPP_TO) ??
    trimOrNull(process.env.LEAD_NOTIFICATION_WHATSAPP_TO) ??
    trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER) ??
    DEFAULT_WHATSAPP_NUMBER;
  if (!webhookUrl && !twilioSid) return { status: "skipped" };

  try {
    if (twilioSid) {
      await postTwilioWhatsapp({
        to: whatsappTo,
        body: buildNotificationBody(submission),
      });
    } else if (webhookUrl) {
      await postJson(webhookUrl, {
        event: "lead_submission.created",
        channel: "whatsapp",
        to: whatsappTo,
        text: buildNotificationBody(submission),
        submission,
      });
    }
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "WhatsApp notification failed",
    };
  }
}
