create extension if not exists pgcrypto;

do $$
begin
  create type public.profile_role as enum ('admin', 'employee');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.record_status as enum ('open', 'closed');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text not null default '',
  job_title text not null default '',
  role public.profile_role not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.time_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  work_date date not null,
  entrada time,
  saida_almoco time,
  retorno_almoco time,
  saida time,
  observacao text not null default '',
  status public.record_status not null default 'open',
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.month_closings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  month date not null,
  total_minutes integer not null default 0,
  snapshot jsonb not null default '[]'::jsonb,
  closed_by uuid references public.profiles(id) on delete set null,
  closed_at timestamptz not null default now(),
  unique (user_id, month)
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists time_records_touch_updated_at on public.time_records;
create trigger time_records_touch_updated_at
before update on public.time_records
for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and active = true
  );
$$;

create or replace function public.record_minutes(
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time
)
returns integer
language plpgsql
immutable
as $$
declare
  v_total integer;
begin
  if p_entrada is null or p_saida is null then
    return 0;
  end if;

  if p_saida < p_entrada then
    return 0;
  end if;

  if (p_saida_almoco is null) <> (p_retorno_almoco is null) then
    return 0;
  end if;

  v_total := extract(epoch from (p_saida - p_entrada))::integer / 60;

  if p_saida_almoco is not null and p_retorno_almoco is not null then
    if p_saida_almoco < p_entrada
      or p_retorno_almoco < p_saida_almoco
      or p_retorno_almoco > p_saida then
      return 0;
    end if;

    v_total := v_total - (extract(epoch from (p_retorno_almoco - p_saida_almoco))::integer / 60);
  end if;

  if v_total < 0 or v_total > 1440 then
    return 0;
  end if;

  return v_total;
end;
$$;

create or replace function public.clock_time(p_kind text)
returns public.time_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today date := (timezone('America/Sao_Paulo', now()))::date;
  v_now time := (timezone('America/Sao_Paulo', now()))::time(0);
  v_record public.time_records;
begin
  if v_user is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = v_user and active = true
  ) then
    raise exception 'Usuario inativo';
  end if;

  if p_kind not in ('entrada', 'saida_almoco', 'retorno_almoco', 'saida') then
    raise exception 'Tipo de ponto invalido';
  end if;

  insert into public.time_records (user_id, work_date)
  values (v_user, v_today)
  on conflict (user_id, work_date) do nothing;

  select *
  into v_record
  from public.time_records
  where user_id = v_user and work_date = v_today
  for update;

  if v_record.status <> 'open' then
    raise exception 'Registro fechado';
  end if;

  if p_kind = 'entrada' then
    if v_record.entrada is not null then
      raise exception 'Entrada ja registrada';
    end if;
    update public.time_records set entrada = v_now where id = v_record.id;
  elsif p_kind = 'saida_almoco' then
    if v_record.saida_almoco is not null then
      raise exception 'Saida de almoco ja registrada';
    end if;
    update public.time_records set saida_almoco = v_now where id = v_record.id;
  elsif p_kind = 'retorno_almoco' then
    if v_record.retorno_almoco is not null then
      raise exception 'Retorno de almoco ja registrado';
    end if;
    update public.time_records set retorno_almoco = v_now where id = v_record.id;
  elsif p_kind = 'saida' then
    if v_record.saida is not null then
      raise exception 'Saida ja registrada';
    end if;
    update public.time_records set saida = v_now where id = v_record.id;
  end if;

  select *
  into v_record
  from public.time_records
  where id = v_record.id;

  return v_record;
end;
$$;

create or replace function public.close_month(p_user_id uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date := date_trunc('month', p_month)::date;
  v_end date := (date_trunc('month', p_month)::date + interval '1 month')::date;
  v_snapshot jsonb;
  v_total integer;
  v_closing_id uuid;
begin
  if not public.is_admin() then
    raise exception 'Apenas administradores podem fechar o mes';
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.work_date), '[]'::jsonb)
  into v_snapshot
  from public.time_records t
  where t.user_id = p_user_id
    and t.work_date >= v_start
    and t.work_date < v_end;

  select coalesce(sum(public.record_minutes(entrada, saida_almoco, retorno_almoco, saida)), 0)
  into v_total
  from public.time_records
  where user_id = p_user_id
    and work_date >= v_start
    and work_date < v_end;

  insert into public.month_closings (user_id, month, total_minutes, snapshot, closed_by)
  values (p_user_id, v_start, v_total, v_snapshot, auth.uid())
  on conflict (user_id, month)
  do update set
    total_minutes = excluded.total_minutes,
    snapshot = excluded.snapshot,
    closed_by = excluded.closed_by,
    closed_at = now()
  returning id into v_closing_id;

  delete from public.time_records
  where user_id = p_user_id
    and work_date >= v_start
    and work_date < v_end;

  return jsonb_build_object(
    'closing_id', v_closing_id,
    'total_minutes', v_total,
    'records', jsonb_array_length(v_snapshot)
  );
end;
$$;

create or replace function public.audit_time_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
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
after update or delete on public.time_records
for each row execute function public.audit_time_records();

alter table public.profiles enable row level security;
alter table public.time_records enable row level security;
alter table public.audit_logs enable row level security;
alter table public.month_closings enable row level security;

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin
on public.profiles
for select
to authenticated
using (id = auth.uid() or public.is_admin());

drop policy if exists profiles_insert_admin on public.profiles;
create policy profiles_insert_admin
on public.profiles
for insert
to authenticated
with check (public.is_admin());

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists time_records_select_own_or_admin on public.time_records;
create policy time_records_select_own_or_admin
on public.time_records
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists time_records_insert_admin on public.time_records;
create policy time_records_insert_admin
on public.time_records
for insert
to authenticated
with check (public.is_admin());

drop policy if exists time_records_update_admin on public.time_records;
create policy time_records_update_admin
on public.time_records
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists time_records_delete_admin on public.time_records;
create policy time_records_delete_admin
on public.time_records
for delete
to authenticated
using (public.is_admin());

drop policy if exists audit_logs_select_admin on public.audit_logs;
create policy audit_logs_select_admin
on public.audit_logs
for select
to authenticated
using (public.is_admin());

drop policy if exists month_closings_select_own_or_admin on public.month_closings;
create policy month_closings_select_own_or_admin
on public.month_closings
for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists month_closings_insert_admin on public.month_closings;
create policy month_closings_insert_admin
on public.month_closings
for insert
to authenticated
with check (public.is_admin());

drop policy if exists month_closings_update_admin on public.month_closings;
create policy month_closings_update_admin
on public.month_closings
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.time_records to authenticated;
grant select on public.audit_logs to authenticated;
grant select, insert, update on public.month_closings to authenticated;
grant execute on function public.clock_time(text) to authenticated;
grant execute on function public.close_month(uuid, date) to authenticated;
