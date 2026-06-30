import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const ACCESS_LOG_COOKIE = "cp_access_log_id";

function isEmail(value) {
  return value.includes("@");
}

function getClientIp(request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    ""
  );
}

function setAccessLogCookie(response, logId) {
  response.cookies.set(ACCESS_LOG_COOKIE, logId, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: 60 * 60 * 24,
  });
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

  const service = createAdminClient();
  let email = identifier.toLowerCase();

  if (!isEmail(identifier)) {
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
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return NextResponse.json(
      { error: "Nome/email ou senha incorretos." },
      { status: 401 }
    );
  }

  const now = new Date().toISOString();
  const { data: log } = await service
    .from("access_logs")
    .insert({
      user_id: data.user.id,
      login_at: now,
      last_seen_at: now,
      user_agent: request.headers.get("user-agent") || "",
      ip_address: getClientIp(request),
    })
    .select("id")
    .single();

  const response = NextResponse.json({ ok: true });

  if (log?.id) {
    setAccessLogCookie(response, log.id);
  }

  return response;
}