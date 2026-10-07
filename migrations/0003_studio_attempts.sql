create table if not exists studio_attempts (
  id text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now()
);
