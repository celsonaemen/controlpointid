create or replace function public.save_day_record(
  p_work_date date,
  p_entrada time,
  p_saida_almoco time,
  p_retorno_almoco time,
  p_saida time,
  p_observacao text default ''
)
returns public.time_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_record public.time_records;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_month date := date_trunc('month', p_work_date)::date;
begin
  if auth.uid() is null then
    raise exception 'Usuario nao autenticado';
  end if;

  if p_work_date is null then
    raise exception 'Data do ponto obrigatoria';
  end if;

  if p_work_date > v_today then
    raise exception 'Funcionario nao pode salvar data futura';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and active = true
  ) then
    raise exception 'Usuario inativo';
  end if;

  if exists (
    select 1
    from public.month_closings
    where user_id = auth.uid()
      and month = v_month
  ) then
    raise exception 'Este mes ja foi fechado';
  end if;

  if p_entrada is null or p_saida is null then
    raise exception 'Informe entrada e saida para concluir o dia';
  end if;

  if p_retorno_almoco is not null and p_saida_almoco is null then
    raise exception 'Informe a saida do almoco antes do retorno';
  end if;

  if p_saida_almoco is not null and p_retorno_almoco is null then
    raise exception 'Informe o retorno do almoco antes da saida final';
  end if;

  if p_saida_almoco is not null and p_saida_almoco < p_entrada then
    raise exception 'Saida do almoco nao pode ser antes da entrada';
  end if;

  if p_retorno_almoco is not null and p_retorno_almoco < p_saida_almoco then
    raise exception 'Retorno do almoco nao pode ser antes da saida do almoco';
  end if;

  if p_saida < p_entrada then
    raise exception 'Saida nao pode ser antes da entrada';
  end if;

  if p_retorno_almoco is not null and p_saida < p_retorno_almoco then
    raise exception 'Saida nao pode ser antes do retorno do almoco';
  end if;

  insert into public.time_records (
    user_id,
    work_date,
    entrada,
    saida_almoco,
    retorno_almoco,
    saida,
    observacao,
    status,
    closed_at
  ) values (
    auth.uid(),
    p_work_date,
    p_entrada,
    p_saida_almoco,
    p_retorno_almoco,
    p_saida,
    coalesce(p_observacao, ''),
    'open',
    null
  )
  on conflict (user_id, work_date)
  do update set
    entrada = excluded.entrada,
    saida_almoco = excluded.saida_almoco,
    retorno_almoco = excluded.retorno_almoco,
    saida = excluded.saida,
    observacao = excluded.observacao,
    status = 'open',
    closed_at = null,
    updated_at = now()
  returning * into v_record;

  return v_record;
end;
$$;

grant execute on function public.save_day_record(date, time, time, time, time, text) to authenticated;