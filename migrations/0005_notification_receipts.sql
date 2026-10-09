-- SMTP evidence for each notification, so "sent" can be traced in the mailbox:
--   notification_message_id: the Message-ID header (search Gmail with rfc822msgid:)
--   notification_response:   the server's final reply, e.g. "250 2.0.0 OK ... gsmtp"
alter table briefs add column if not exists notification_message_id text;
alter table briefs add column if not exists notification_response text;
