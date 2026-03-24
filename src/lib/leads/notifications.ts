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
  const webhookUrl = trimOrNull(process.env.LEAD_EMAIL_WEBHOOK_URL);
  if (!webhookUrl) return { status: "skipped" };

  try {
    await postJson(webhookUrl, {
      event: "lead_submission.created",
      channel: "email",
      to: trimOrNull(process.env.LEAD_NOTIFICATION_EMAIL_TO),
      subject: `New QuickAIBuy lead: ${submission.fullName}`,
      text: buildNotificationBody(submission),
      submission,
    });
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
  if (!webhookUrl) return { status: "skipped" };

  try {
    await postJson(webhookUrl, {
      event: "lead_submission.created",
      channel: "whatsapp",
      to: trimOrNull(process.env.LEAD_NOTIFICATION_WHATSAPP_TO) ??
        trimOrNull(process.env.NEXT_PUBLIC_CONTACT_WHATSAPP_NUMBER) ??
        DEFAULT_WHATSAPP_NUMBER,
      text: buildNotificationBody(submission),
      submission,
    });
    return { status: "sent" };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "WhatsApp notification failed",
    };
  }
}
