alter table public.profiles
  add column if not exists expected_daily_minutes integer not null default 480,
  add column if not exists expected_start_time time not null default '08:00',
  add column if not exists expected_end_time time not null default '17:00',
  add column if not exists workdays integer[] not null default array[1,2,3,4,5];

alter table public.profiles drop constraint if exists profiles_expected_daily_minutes_check;
alter table public.profiles add constraint profiles_expected_daily_minutes_check
  check (expected_daily_minutes >= 0 and expected_daily_minutes <= 1440);

alter table public.profiles drop constraint if exists profiles_workdays_check;
alter table public.profiles add constraint profiles_workdays_check
  check (workdays <@ array[0,1,2,3,4,5,6]);

create table if not exists public.timesheet_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  total_minutes integer not null default 0,
  snapshot jsonb not null default '[]'::jsonb,
  note text not null default '',
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, month)
);

drop trigger if exists timesheet_approvals_touch_updated_at on public.timesheet_approvals;
create trigger timesheet_approvals_touch_updated_at
before update on public.timesheet_approvals
for each row execute function public.touch_updated_at();

alter table public.timesheet_approvals enable row level security;

drop policy if exists timesheet_approvals_select_own_or_admin on public.timesheet_approvals;
create policy timesheet_approvals_select_own_or_admin
on public.timesheet_approvals
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists timesheet_approvals_insert_own on public.timesheet_approvals;
create policy timesheet_approvals_insert_own
on public.timesheet_approvals
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'employee'
      and active = true
  )
);

drop policy if exists timesheet_approvals_update_own_or_admin on public.timesheet_approvals;
create policy timesheet_approvals_update_own_or_admin
on public.timesheet_approvals
for update
to authenticated
using (user_id = auth.uid() or public.is_admin())
with check (user_id = auth.uid() or public.is_admin());

drop policy if exists timesheet_approvals_delete_admin on public.timesheet_approvals;
create policy timesheet_approvals_delete_admin
on public.timesheet_approvals
for delete
to authenticated
using (public.is_admin());

create or replace function public.audit_time_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'INSERT', tg_table_name, new.id, null, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'UPDATE', tg_table_name, new.id, to_jsonb(old), to_jsonb(new));
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    values (auth.uid(), 'DELETE', tg_table_name, old.id, to_jsonb(old), null);
    return old;
  end if;

  return null;
end;
$$;

drop trigger if exists time_records_audit on public.time_records;
create trigger time_records_audit
after insert or update or delete on public.time_records
for each row execute function public.audit_time_records();

grant select, insert, update, delete on public.timesheet_approvals to authenticated;