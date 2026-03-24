CREATE TABLE IF NOT EXISTS lead_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL,
  company text,
  email text NOT NULL,
  interest text NOT NULL,
  message text NOT NULL,
  source_page text NOT NULL DEFAULT '/',
  status text NOT NULL DEFAULT 'NEW',
  email_notification_status text NOT NULL DEFAULT 'PENDING',
  whatsapp_notification_status text NOT NULL DEFAULT 'PENDING',
  email_notification_error text,
  whatsapp_notification_error text,
  notified_at timestamp,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_submissions_created_idx
  ON lead_submissions (created_at);

CREATE INDEX IF NOT EXISTS lead_submissions_status_idx
  ON lead_submissions (status, created_at);

CREATE INDEX IF NOT EXISTS lead_submissions_email_idx
  ON lead_submissions (email);
