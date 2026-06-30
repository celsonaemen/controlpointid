import { createBrowserClient } from "@supabase/ssr";

function getSupabaseUrl() {
  return process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function getSupabasePublicKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function hasBrowserSupabaseConfig() {
  return Boolean(getSupabaseUrl() && getSupabasePublicKey());
}

export function createClient() {
  if (!hasBrowserSupabaseConfig()) {
    throw new Error("Supabase nao configurado");
  }

  return createBrowserClient(
    getSupabaseUrl(),
    getSupabasePublicKey()
  );
}
