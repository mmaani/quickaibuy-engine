import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leadSubmissions } from "@/lib/db/schema";
import { writeAuditLog } from "@/lib/audit/writeAuditLog";
import {
  buildManualWhatsappUrl,
  sendLeadEmailNotification,
  sendLeadWhatsappNotification,
} from "@/lib/leads/notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ContactPayload = {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  interest?: unknown;
  message?: unknown;
  sourcePage?: unknown;
};

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  let body: ContactPayload;
  try {
    body = (await request.json()) as ContactPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const fullName = clean(body.name);
  const company = clean(body.company) || null;
  const email = clean(body.email).toLowerCase();
  const interest = clean(body.interest) || "General Inquiry";
  const message = clean(body.message);
  const sourcePage = clean(body.sourcePage) || "/";

  if (!fullName || !email || !message) {
    return NextResponse.json({ ok: false, error: "name_email_message_required" }, { status: 400 });
  }
  if (!validateEmail(email)) {
    return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
  }

  const inserted = await db
    .insert(leadSubmissions)
    .values({
      fullName,
      company,
      email,
      interest,
      message,
      sourcePage,
      status: "NEW",
      emailNotificationStatus: "PENDING",
      whatsappNotificationStatus: "PENDING",
      metadata: {
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
      },
    })
    .returning({
      id: leadSubmissions.id,
      fullName: leadSubmissions.fullName,
      company: leadSubmissions.company,
      email: leadSubmissions.email,
      interest: leadSubmissions.interest,
      message: leadSubmissions.message,
      sourcePage: leadSubmissions.sourcePage,
      status: leadSubmissions.status,
      createdAt: leadSubmissions.createdAt,
    });

  const submission = inserted[0];

  const [emailNotification, whatsappNotification] = await Promise.all([
    sendLeadEmailNotification({
      ...submission,
      company: submission.company ?? null,
      createdAt: submission.createdAt.toISOString(),
    }),
    sendLeadWhatsappNotification({
      ...submission,
      company: submission.company ?? null,
      createdAt: submission.createdAt.toISOString(),
    }),
  ]);

  await db
    .update(leadSubmissions)
    .set({
      emailNotificationStatus: emailNotification.status.toUpperCase(),
      whatsappNotificationStatus: whatsappNotification.status.toUpperCase(),
      emailNotificationError: emailNotification.error ?? null,
      whatsappNotificationError: whatsappNotification.error ?? null,
      notifiedAt:
        emailNotification.status === "sent" || whatsappNotification.status === "sent"
          ? new Date()
          : null,
      updatedAt: new Date(),
    })
    .where(eq(leadSubmissions.id, submission.id));

  await writeAuditLog({
    actorType: "PUBLIC",
    actorId: "website-contact-form",
    entityType: "LEAD_SUBMISSION",
    entityId: submission.id,
    eventType: "LEAD_SUBMISSION_CREATED",
    details: {
      fullName,
      email,
      interest,
      sourcePage,
      emailNotificationStatus: emailNotification.status,
      whatsappNotificationStatus: whatsappNotification.status,
    },
  });

  return NextResponse.json({
    ok: true,
    id: submission.id,
    status: "NEW",
    emailNotificationStatus: emailNotification.status,
    whatsappNotificationStatus: whatsappNotification.status,
    manualWhatsappUrl: buildManualWhatsappUrl({
      id: submission.id,
      fullName,
      company,
      email,
      interest,
      message,
      sourcePage,
      status: "NEW",
      createdAt: submission.createdAt.toISOString(),
    }),
  });
}
