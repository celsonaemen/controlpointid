import { NextResponse } from "next/server";
import { endOfMonthKey, monthStartKey, totalMinutes } from "@/lib/date";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function currentMonthInSaoPaulo() {
  const parts = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}`;
}

function normalizeMonth(value) {
  const month = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(month) ? month : currentMonthInSaoPaulo();
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

  if (profileError || !profile?.active || profile.role !== "employee") {
    return NextResponse.json({ error: "Usuario nao autorizado." }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const month = normalizeMonth(body.month);

  if (month > currentMonthInSaoPaulo()) {
    return NextResponse.json({ error: "Nao e possivel confirmar mes futuro." }, { status: 400 });
  }

  const service = createAdminClient();
  const { data: records, error: recordsError } = await service
    .from("time_records")
    .select("*")
    .eq("user_id", user.id)
    .gte("work_date", monthStartKey(month))
    .lte("work_date", endOfMonthKey(month))
    .order("work_date", { ascending: true });

  if (recordsError) {
    return NextResponse.json({ error: recordsError.message }, { status: 400 });
  }

  if (!records || records.length === 0) {
    return NextResponse.json({ error: "Nao ha pontos neste mes para confirmar." }, { status: 400 });
  }

  const { data, error } = await service
    .from("timesheet_approvals")
    .upsert(
      {
        user_id: user.id,
        month: monthStartKey(month),
        total_minutes: totalMinutes(records),
        snapshot: records,
        note: String(body.note || ""),
        approved_at: new Date().toISOString(),
      },
      { onConflict: "user_id,month" }
    )
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ approval: data });
}