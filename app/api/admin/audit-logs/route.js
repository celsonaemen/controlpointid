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

function monthBounds(monthKey) {
  const fallback = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(monthKey || "") ? monthKey : fallback;
  return {
    month,
    start: `${month}-01`,
    end: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10),
  };
}

function recordPayload(log) {
  return log.new_data || log.old_data || {};
}

export async function GET(request) {
  const admin = await getAdminProfile();

  if (!admin) {
    return NextResponse.json({ error: "Nao autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("user_id") || "";
  const { month, start, end } = monthBounds(searchParams.get("month"));
  const service = createAdminClient();

  const { data: logs, error } = await service
    .from("audit_logs")
    .select("id,actor_id,action,table_name,record_id,old_data,new_data,created_at")
    .eq("table_name", "time_records")
    .order("created_at", { ascending: false })
    .limit(250);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const filteredLogs = (logs || []).filter((log) => {
    const payload = recordPayload(log);
    const workDate = payload.work_date || "";
    const payloadUserId = payload.user_id || "";
    if (userId && payloadUserId !== userId) return false;
    return workDate >= start && workDate < end;
  }).slice(0, 80);

  const ids = [...new Set(filteredLogs.flatMap((log) => [recordPayload(log).user_id, log.actor_id]).filter(Boolean))];
  let profilesById = {};

  if (ids.length > 0) {
    const { data: profiles, error: profileError } = await service
      .from("profiles")
      .select("id,email,full_name,role")
      .in("id", ids);

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 });
    }

    profilesById = Object.fromEntries((profiles || []).map((profile) => [profile.id, profile]));
  }

  return NextResponse.json({
    month,
    logs: filteredLogs.map((log) => {
      const payload = recordPayload(log);
      return {
        ...log,
        profile: profilesById[payload.user_id] || null,
        actor: profilesById[log.actor_id] || null,
      };
    }),
  });
}