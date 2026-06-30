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