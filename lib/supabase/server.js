import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
}

function getSupabasePublicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY
  );
}

function getSupabaseServiceKey() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
}

export function hasServerSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabasePublicKey());
}

export function hasServiceRoleConfig() {
  return Boolean(getSupabaseUrl() && getSupabaseServiceKey());
}

export async function createClient() {
  if (!hasServerSupabaseConfig()) {
    throw new Error("Supabase nao configurado");
  }

  const cookieStore = await cookies();

  return createServerClient(
    getSupabaseUrl(),
    getSupabasePublicKey(),
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Server Components cannot always write cookies. Middleware refreshes sessions.
          }
        },
      },
    }
  );
}

export function createAdminClient() {
  if (!hasServiceRoleConfig()) {
    throw new Error("Service role do Supabase nao configurada");
  }

  return createSupabaseClient(
    getSupabaseUrl(),
    getSupabaseServiceKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
