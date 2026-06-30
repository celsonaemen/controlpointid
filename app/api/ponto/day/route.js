import { NextResponse } from "next/server";
import { calculateRecordState, cleanTime } from "@/lib/date";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function dateKeyInSaoPaulo(date = new Date()) {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function normalizeBody(body) {
  return {
    work_date: String(body.work_date || "").trim(),
    entrada: cleanTime(body.entrada),
    saida_almoco: cleanTime(body.saida_almoco),
    retorno_almoco: cleanTime(body.retorno_almoco),
    saida: cleanTime(body.saida),
    observacao: String(body.observacao || ""),
  };
}

export async function POST(request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role, active")
    .eq("id", user.id)
    .single();

  if (profileError || !profile?.active) {
    return NextResponse.json({ error: "Usuario inativo" }, { status: 403 });
  }

  if (profile.role !== "employee") {
    return NextResponse.json(
      { error: "Administradores nao possuem folha de ponto." },
      { status: 403 }
    );
  }

  const body = normalizeBody(await request.json());

  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.work_date)) {
    return NextResponse.json(
      { error: "Data do ponto obrigatoria." },
      { status: 400 }
    );
  }

  if (body.work_date > dateKeyInSaoPaulo()) {
    return NextResponse.json(
      { error: "Funcionario nao pode salvar data futura." },
      { status: 400 }
    );
  }

  const state = calculateRecordState(body);

  if (!state.valid) {
    return NextResponse.json(
      { error: "Horarios invalidos. Confira a ordem dos campos." },
      { status: 400 }
    );
  }

  if (!state.complete) {
    return NextResponse.json(
      { error: "Preencha a saida final para concluir o dia." },
      { status: 400 }
    );
  }

  const service = createAdminClient();
  const month = `${body.work_date.slice(0, 7)}-01`;
  const { data: closing, error: closingError } = await service
    .from("month_closings")
    .select("id")
    .eq("user_id", user.id)
    .eq("month", month)
    .maybeSingle();

  if (closingError) {
    return NextResponse.json({ error: closingError.message }, { status: 400 });
  }

  if (closing) {
    return NextResponse.json(
      { error: "Este mes ja foi fechado." },
      { status: 409 }
    );
  }

  const { data, error } = await service
    .from("time_records")
    .upsert(
      {
        user_id: user.id,
        work_date: body.work_date,
        entrada: body.entrada || null,
        saida_almoco: body.saida_almoco || null,
        retorno_almoco: body.retorno_almoco || null,
        saida: body.saida || null,
        observacao: body.observacao,
        status: "open",
        closed_at: null,
      },
      { onConflict: "user_id,work_date" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ record: data });
}
