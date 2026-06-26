"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn } from "lucide-react";
import { createClient, hasBrowserSupabaseConfig } from "@/lib/supabase/client";

export default function LoginForm({ inactive }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const configured = hasBrowserSupabaseConfig();
  const supabase = useMemo(() => (configured ? createClient() : null), [configured]);

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    setLoading(false);

    if (error) {
      setMessage("Email ou senha incorretos.");
      return;
    }

    router.refresh();
    window.location.href = "/";
  }

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="brand-mark">
          <LockKeyhole size={28} />
        </div>
        <p className="eyebrow">Sistema interno</p>
        <h1>Controle de Ponto</h1>
        <p className="muted">
          Acesso exclusivo para funcionarios e administradores cadastrados.
        </p>

        {!configured ? (
          <div className="notice danger">
            Configure as variaveis do Supabase em <code>.env.local</code>.
          </div>
        ) : (
          <form className="login-form" onSubmit={handleSubmit}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <label>
              Senha
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>
            {inactive ? (
              <div className="notice danger">Usuario inativo. Fale com o administrador.</div>
            ) : null}
            {message ? <div className="notice danger">{message}</div> : null}
            <button className="primary full" type="submit" disabled={loading}>
              <LogIn size={18} />
              {loading ? "Entrando..." : "Entrar"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
