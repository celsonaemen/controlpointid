create table if not exists public.access_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  login_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  user_agent text not null default '',
  ip_address text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists access_logs_login_at_idx on public.access_logs (login_at desc);
create index if not exists access_logs_user_login_idx on public.access_logs (user_id, login_at desc);

alter table public.access_logs enable row level security;

drop policy if exists access_logs_select_admin on public.access_logs;
create policy access_logs_select_admin
on public.access_logs
for select
to authenticated
using (public.is_admin());

grant select on public.access_logs to authenticated;