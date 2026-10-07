create table if not exists studio_gate (
  id integer primary key default 1 check (id = 1),
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

create table if not exists studio_sessions (
  token_hash text primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists briefs (
  id text primary key,
  reference text not null unique,
  status text not null default 'draft',
  upload_token_hash text,
  upload_expires_at timestamptz,
  business_name text not null default '',
  client_name text not null default '',
  client_email text not null default '',
  client_phone text not null default '',
  payload jsonb not null,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists brief_files (
  id text primary key,
  brief_id text not null references briefs (id) on delete cascade,
  kind text not null,
  filename text not null,
  mime text not null,
  size_bytes integer not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists briefs_status_submitted_idx on briefs (status, submitted_at desc);
create index if not exists briefs_upload_token_idx on briefs (upload_token_hash);
create index if not exists brief_files_brief_idx on brief_files (brief_id);
