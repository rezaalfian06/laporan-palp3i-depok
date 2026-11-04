create table if not exists public.users (
  id text primary key,
  record jsonb not null
);

create unique index if not exists users_username_lower_key
  on public.users (lower(record->>'username'));

create table if not exists public.reports (
  id text primary key,
  record jsonb not null
);

create table if not exists public.login_limits (
  id text primary key,
  record jsonb not null
);

create table if not exists public.app_settings (
  id text primary key,
  record jsonb not null
);

alter table public.users enable row level security;
alter table public.reports enable row level security;
alter table public.login_limits enable row level security;
alter table public.app_settings enable row level security;

grant all on public.users, public.reports, public.login_limits, public.app_settings to service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('laporan-attachments', 'laporan-attachments', false, 4194304)
on conflict (id) do update
set public = false, file_size_limit = 4194304;
