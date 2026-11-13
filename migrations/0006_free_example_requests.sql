-- Free website homepage example requests.
--
-- A second, shorter form shares the briefs table with the full website brief,
-- so it inherits the same private file storage, upload sessions, idempotent
-- submit, notification claim and Studio inbox. `form_kind` keeps the two
-- apart: every existing row is a project brief and keeps behaving as one.
--
-- `campaign_ref` is the campaign-level attribution from the cold email link
-- (?c=…). It identifies a campaign, never a recipient.
--
-- Free example requests are also delivered to PeakSwift Leads by a signed
-- server-to-server webhook. The delivery is tracked here, on the row it
-- describes, with the same claim / retry pattern as notifications:
--   not_applicable - project briefs; never sent to Leads
--   pending        - submitted, not yet delivered
--   sending        - claimed by one request
--   delivered      - Leads accepted it (2xx)
--   failed         - last attempt failed; retried later
--   not_configured - no Leads URL or secret on this deployment; retried later
-- Forms stays the source of truth: Leads keeps a reference, never the files.
--
-- Additive only.
alter table briefs add column if not exists form_kind text not null default 'project';
alter table briefs add column if not exists campaign_ref text not null default '';

alter table briefs add column if not exists leads_sync_status text not null default 'not_applicable';
alter table briefs add column if not exists leads_sync_attempts integer not null default 0;
alter table briefs add column if not exists leads_sync_claimed_at timestamptz;
alter table briefs add column if not exists leads_synced_at timestamptz;
alter table briefs add column if not exists leads_sync_error text;
alter table briefs add column if not exists leads_sync_response text;

create index if not exists briefs_form_kind_idx on briefs (form_kind, submitted_at desc);
create index if not exists briefs_leads_sync_idx on briefs (leads_sync_status, submitted_at);
