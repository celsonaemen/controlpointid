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

export async function PATCH(request, { params }) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const body = await request.json();
  const updates = {};

  if ("full_name" in body) updates.full_name = String(body.full_name || "").trim();
  if ("job_title" in body) updates.job_title = String(body.job_title || "").trim();
  if ("active" in body) updates.active = Boolean(body.active);
  if ("role" in body) updates.role = body.role === "admin" ? "admin" : "employee";

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nada para atualizar." }, { status: 400 });
  }

  const { id } = await params;
  const service = createAdminClient();
  const { error } = await service.from("profiles").update(updates).eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
