-- Email notification tracking for submitted briefs.
--
-- notification_status:
--   pending  - submitted, email not yet attempted
--   sending  - claimed by one request; others must not send
--   sent     - provider accepted the email
--   failed   - last attempt failed; eligible for retry
--   skipped  - submitted before notifications existed; never emailed
--
-- The brief itself is saved before any email is attempted, so a provider
-- failure never loses a submission.
alter table briefs add column if not exists notification_status text not null default 'pending';
alter table briefs add column if not exists notification_attempts integer not null default 0;
alter table briefs add column if not exists notification_claimed_at timestamptz;
alter table briefs add column if not exists notification_sent_at timestamptz;
alter table briefs add column if not exists notification_error text;

-- Briefs already in the inbox were read there; do not email them retroactively.
update briefs set notification_status = 'skipped' where status in ('new', 'reviewed');

create index if not exists briefs_notification_idx on briefs (notification_status, submitted_at);
