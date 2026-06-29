import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

function isEmail(value) {
  return value.includes("@");
}

export async function POST(request) {
  const body = await request.json();
  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");

  if (!identifier || !password) {
    return NextResponse.json(
      { error: "Informe email ou nome e senha." },
      { status: 400 }
    );
  }

  let email = identifier.toLowerCase();

  if (!isEmail(identifier)) {
    const service = createAdminClient();
    const { data: profiles, error } = await service
      .from("profiles")
      .select("email")
      .ilike("full_name", identifier)
      .limit(2);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!profiles || profiles.length === 0) {
      return NextResponse.json(
        { error: "Nome ou senha incorretos." },
        { status: 401 }
      );
    }

    if (profiles.length > 1) {
      return NextResponse.json(
        { error: "Existe mais de um usuario com esse nome. Entre usando o email." },
        { status: 409 }
      );
    }

    email = profiles[0].email;
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return NextResponse.json(
      { error: "Nome/email ou senha incorretos." },
      { status: 401 }
    );
  }

  return NextResponse.json({ ok: true });
}