import { randomBytes } from "crypto";
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

function generateBlockedPassword() {
  return `${randomBytes(24).toString("base64url")}Aa1!`;
}

export async function PATCH(request, { params }) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { id } = await params;

  if (id === admin.id) {
    return NextResponse.json(
      { error: "Voce nao pode bloquear seu proprio acesso de administrador." },
      { status: 400 }
    );
  }

  const service = createAdminClient();
  const { data: profile, error: profileError } = await service
    .from("profiles")
    .select("id, full_name, email")
    .eq("id", id)
    .maybeSingle();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 400 });
  }

  if (!profile) {
    return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
  }

  const { error: updateError } = await service
    .from("profiles")
    .update({ active: false })
    .eq("id", id);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  const { error: passwordError } = await service.auth.admin.updateUserById(id, {
    password: generateBlockedPassword(),
  });

  if (passwordError) {
    return NextResponse.json({
      ok: true,
      warning: `Usuario desativado, mas nao foi possivel trocar a senha: ${passwordError.message}`,
    });
  }

  return NextResponse.json({ ok: true });
}