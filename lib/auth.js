import { redirect } from "next/navigation";
import { createClient, hasServerSupabaseConfig } from "@/lib/supabase/server";

export async function getSessionProfile() {
  if (!hasServerSupabaseConfig()) {
    return { envMissing: true, user: null, profile: null };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { envMissing: false, user: null, profile: null };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return { envMissing: false, user, profile };
}

export async function requireUser() {
  const session = await getSessionProfile();

  if (session.envMissing || !session.user) {
    redirect("/login");
  }

  if (!session.profile?.active) {
    redirect("/login?inactive=1");
  }

  return session;
}

export async function requireAdmin() {
  const session = await requireUser();

  if (session.profile?.role !== "admin") {
    redirect("/ponto");
  }

  return session;
}
