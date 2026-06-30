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

function monthRange(monthKey) {
  const match = /^\d{4}-\d{2}$/.test(monthKey || "") ? monthKey : new Date().toISOString().slice(0, 7);
  const [year, month] = match.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0));
  return { start: start.toISOString(), end: end.toISOString(), month: match };
}

function durationMinutes(log) {
  const start = new Date(log.login_at).getTime();
  const end = new Date(log.last_seen_at || log.login_at).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return Math.ceil((end - start) / 60000);
}

export async function GET(request) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { start, end, month } = monthRange(searchParams.get("month"));
  const userId = searchParams.get("user_id") || "";
  const service = createAdminClient();

  let query = service
    .from("access_logs")
    .select("id,user_id,login_at,last_seen_at,user_agent,ip_address")
    .gte("login_at", start)
    .lt("login_at", end)
    .order("login_at", { ascending: false })
    .limit(500);

  if (userId) {
    query = query.eq("user_id", userId);
  }

  const { data: logs, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const userIds = [...new Set((logs || []).map((log) => log.user_id))];
  let profilesById = {};

  if (userIds.length > 0) {
    const { data: profiles, error: profileError } = await service
      .from("profiles")
      .select("id,email,full_name,role")
      .in("id", userIds);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    profilesById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
  }

  return NextResponse.json({
    month,
    logs: (logs || []).map((log) => ({
      ...log,
      duration_minutes: durationMinutes(log),
      profile: profilesById[log.user_id] || null,
    })),
  });
}