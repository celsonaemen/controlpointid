import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

async function getAdminProfile() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role, active")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin" || !profile?.active) return null;
  return profile;
}

function cleanEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function cleanTimeValue(value) {
  const time = String(value || "").trim().slice(0, 5);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : "";
}

function normalizeWorkdays(value) {
  if (!Array.isArray(value)) return null;
  const days = [...new Set(value.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);
  return days.length > 0 ? days : null;
}

export async function PATCH(request, { params }) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const updates = {};
  const service = createAdminClient();

  if (id === admin.id && (("active" in body && !body.active) || ("role" in body && body.role !== "admin"))) {
    return NextResponse.json(
      { error: "Voce nao pode remover seu proprio acesso de administrador." },
      { status: 400 }
    );
  }

  if ("full_name" in body) {
    const fullName = String(body.full_name || "").trim();
    if (!fullName) return NextResponse.json({ error: "Nome obrigatorio." }, { status: 400 });
    updates.full_name = fullName;
  }

  if ("job_title" in body) updates.job_title = String(body.job_title || "").trim();
  if ("active" in body) updates.active = Boolean(body.active);
  if ("role" in body) updates.role = body.role === "admin" ? "admin" : "employee";

  if ("expected_daily_minutes" in body) {
    const minutes = Number(body.expected_daily_minutes);
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
      return NextResponse.json({ error: "Jornada diaria invalida." }, { status: 400 });
    }
    updates.expected_daily_minutes = Math.round(minutes);
  }

  if ("expected_start_time" in body) {
    const startTime = cleanTimeValue(body.expected_start_time);
    if (!startTime) return NextResponse.json({ error: "Horario de entrada invalido." }, { status: 400 });
    updates.expected_start_time = startTime;
  }

  if ("expected_end_time" in body) {
    const endTime = cleanTimeValue(body.expected_end_time);
    if (!endTime) return NextResponse.json({ error: "Horario de saida invalido." }, { status: 400 });
    updates.expected_end_time = endTime;
  }

  if ("workdays" in body) {
    const workdays = normalizeWorkdays(body.workdays);
    if (!workdays) return NextResponse.json({ error: "Dias de trabalho invalidos." }, { status: 400 });
    updates.workdays = workdays;
  }

  if ("email" in body) {
    const email = cleanEmail(body.email);
    if (!email || !email.includes("@")) {
      return NextResponse.json({ error: "Email invalido." }, { status: 400 });
    }

    const { error: authError } = await service.auth.admin.updateUserById(id, {
      email,
      email_confirm: true,
    });

    if (authError) {
      return NextResponse.json({ error: authError.message }, { status: 400 });
    }

    updates.email = email;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { error } = await service.from("profiles").update(updates).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request, { params }) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json(
      { error: "Voce nao pode apagar seu proprio usuario." },
      { status: 400 }
    );
  }

  const service = createAdminClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id")
    .eq("id", id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
  }

  const { error } = await service.auth.admin.deleteUser(id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}