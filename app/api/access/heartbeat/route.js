import { NextResponse } from "next/server";
import { createAdminClient, createClient } from "@/lib/supabase/server";

const ACCESS_LOG_COOKIE = "cp_access_log_id";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const service = createAdminClient();
  const now = new Date().toISOString();
  const logId = request.cookies.get(ACCESS_LOG_COOKIE)?.value;
  const response = NextResponse.json({ ok: true });

  if (logId) {
    const { data } = await service
      .from("access_logs")
      .update({ last_seen_at: now })
      .eq("id", logId)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (data?.id) {
      return response;
    }
  }

  const { data: log } = await service
    .from("access_logs")
    .insert({
      user_id: user.id,
      login_at: now,
      last_seen_at: now,
      user_agent: request.headers.get("user-agent") || "",
      ip_address: getClientIp(request),
    })
    .select("id")
    .single();

  if (log?.id) {
    setAccessLogCookie(response, log.id);
  }

  return response;
}