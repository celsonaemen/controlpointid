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