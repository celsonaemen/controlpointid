"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, LogIn } from "lucide-react";

export default function LoginForm({ inactive }) {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");
    setLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const result = await response.json();

    setLoading(false);

    if (!response.ok) {
      setMessage(result.error || "Nome/email ou senha incorretos.");
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

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email ou nome cadastrado
            <input
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
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
      </section>
    </main>
  );
}
