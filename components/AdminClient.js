"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Lock,
  LogOut,
  Plus,
  Printer,
  RefreshCcw,
  Save,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  TIME_FIELDS,
  formatRecordDuration,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  monthStartKey,
  totalMinutes,
} from "@/lib/date";

const emptyEmployee = {
  full_name: "",
  email: "",
  password: "",
  job_title: "",
  role: "employee",
};

export default function AdminClient({ adminProfile }) {
  const supabase = useMemo(() => createClient(), []);
  const [profiles, setProfiles] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [month, setMonth] = useState(currentMonthKey());
  const [records, setRecords] = useState([]);
  const [closing, setClosing] = useState(null);
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedProfile = profiles.find((profile) => profile.id === selectedUserId);
  const monthDays = daysInMonth(month);
  const recordsByDate = useMemo(() => {
    return Object.fromEntries(records.map((record) => [record.work_date, record]));
  }, [records]);
  const snapshotRecords = useMemo(() => closing?.snapshot || [], [closing]);
  const snapshotByDate = useMemo(() => {
    return Object.fromEntries(snapshotRecords.map((record) => [record.work_date, record]));
  }, [snapshotRecords]);
  const sheetRecordsByDate = records.length > 0 ? recordsByDate : snapshotByDate;
  const monthTotal = records.length > 0 ? totalMinutes(records) : closing?.total_minutes || 0;
  const isClosed = Boolean(closing) && records.length === 0;

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadMonth();
    }
  }, [selectedUserId, month]);

  async function loadProfiles() {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .order("full_name", { ascending: true });

    if (error) {
      setMessage(error.message);
      return;
    }

    setProfiles(data || []);
    if (!selectedUserId && data?.length) {
      const firstEmployee = data.find((profile) => profile.role === "employee") || data[0];
      setSelectedUserId(firstEmployee.id);
    }
  }

  async function loadMonth() {
    setMessage("");
    const [{ data: recordData, error: recordError }, { data: closingData }] =
      await Promise.all([
        supabase
          .from("time_records")
          .select("*")
          .eq("user_id", selectedUserId)
          .gte("work_date", monthStartKey(month))
          .lte("work_date", endOfMonthKey(month))
          .order("work_date", { ascending: true }),
        supabase
          .from("month_closings")
          .select("*")
          .eq("user_id", selectedUserId)
          .eq("month", monthStartKey(month))
          .maybeSingle(),
      ]);

    if (recordError) {
      setMessage(recordError.message);
      return;
    }

    setRecords(recordData || []);
    setClosing(closingData || null);
  }

  async function createEmployee(event) {
    event.preventDefault();
    setLoading(true);
    setMessage("");

    const response = await fetch("/api/admin/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newEmployee),
    });
    const result = await response.json();
    setLoading(false);

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel cadastrar.");
      return;
    }

    setNewEmployee(emptyEmployee);
    setMessage("Usuario cadastrado.");
    await loadProfiles();
  }

  async function updateProfile(profileId, updates) {
    setMessage("");
    const response = await fetch(`/api/admin/employees/${profileId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel atualizar.");
      return;
    }

    await loadProfiles();
  }

  async function saveRecord(dateKey, field, value) {
    if (!selectedUserId || isClosed) return;

    setMessage("");
    const existing = recordsByDate[dateKey];
    const payload = {
      user_id: selectedUserId,
      work_date: dateKey,
      [field]: field === "observacao" ? value : value || null,
    };

    const request = existing
      ? supabase.from("time_records").update(payload).eq("id", existing.id)
      : supabase.from("time_records").insert(payload);

    const { error } = await request;

    if (error) {
      setMessage(error.message);
      return;
    }

    await loadMonth();
  }

  async function closeMonth() {
    if (!selectedUserId) return;
    const ok = window.confirm(
      "Fechar este mes vai salvar um snapshot e limpar os registros ativos. Confirma?"
    );

    if (!ok) return;

    setLoading(true);
    const { error } = await supabase.rpc("close_month", {
      p_user_id: selectedUserId,
      p_month: monthStartKey(month),
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Mes fechado e registros ativos limpos.");
    await loadMonth();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function printSheet() {
    window.print();
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <p className="eyebrow">Administrador</p>
          <h1>Painel de ponto</h1>
          <p className="muted">{adminProfile.full_name}</p>
        </div>
        <div className="header-actions">
          <button className="secondary" type="button" onClick={loadMonth}>
            <RefreshCcw size={18} />
            Atualizar
          </button>
          <button className="secondary" type="button" onClick={printSheet}>
            <Printer size={18} />
            Imprimir folha
          </button>
          <button className="primary" type="button" onClick={closeMonth} disabled={loading}>
            <Lock size={18} />
            Fechar mes
          </button>
          <button className="secondary icon-only" type="button" onClick={signOut} title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {message ? <div className="notice">{message}</div> : null}

      <section className="admin-grid">
        <form className="panel form-panel" onSubmit={createEmployee}>
          <div className="panel-heading">
            <h2>Novo usuario</h2>
            <Plus size={20} />
          </div>
          <label>
            Nome
            <input
              value={newEmployee.full_name}
              onChange={(event) =>
                setNewEmployee({ ...newEmployee, full_name: event.target.value })
              }
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={newEmployee.email}
              onChange={(event) =>
                setNewEmployee({ ...newEmployee, email: event.target.value })
              }
              required
            />
          </label>
          <label>
            Senha inicial
            <input
              type="password"
              minLength={6}
              value={newEmployee.password}
              onChange={(event) =>
                setNewEmployee({ ...newEmployee, password: event.target.value })
              }
              required
            />
          </label>
          <label>
            Cargo
            <input
              value={newEmployee.job_title}
              onChange={(event) =>
                setNewEmployee({ ...newEmployee, job_title: event.target.value })
              }
            />
          </label>
          <label>
            Perfil
            <select
              value={newEmployee.role}
              onChange={(event) =>
                setNewEmployee({ ...newEmployee, role: event.target.value })
              }
            >
              <option value="employee">Funcionario</option>
              <option value="admin">Administrador</option>
            </select>
          </label>
          <button className="primary full" type="submit" disabled={loading}>
            <Save size={18} />
            Cadastrar
          </button>
        </form>

        <section className="panel people-panel">
          <div className="panel-heading">
            <h2>Usuarios</h2>
            <span className="muted">{profiles.length} cadastrados</span>
          </div>
          <div className="people-list">
            {profiles.map((profile) => (
              <div
                className={`person-row ${profile.id === selectedUserId ? "selected" : ""}`}
                key={profile.id}
              >
                <button type="button" onClick={() => setSelectedUserId(profile.id)}>
                  <strong>{profile.full_name || profile.email}</strong>
                  <span>{profile.email}</span>
                </button>
                <select
                  value={profile.role}
                  onChange={(event) =>
                    updateProfile(profile.id, {
                      role: event.target.value,
                    })
                  }
                >
                  <option value="employee">Funcionario</option>
                  <option value="admin">Admin</option>
                </select>
                <label className="inline-check">
                  <input
                    type="checkbox"
                    checked={profile.active}
                    onChange={(event) =>
                      updateProfile(profile.id, {
                        active: event.target.checked,
                      })
                    }
                  />
                  Ativo
                </label>
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Folha mensal</h2>
            <p className="muted">
              {selectedProfile?.full_name || "Selecione um usuario"} - {formatMonthLabel(month)}
            </p>
          </div>
          <div className="month-controls">
            <label>
              Mes
              <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
            </label>
            <div className="metric">
              <span>Total</span>
              <strong>{formatDuration(monthTotal)}</strong>
            </div>
          </div>
        </div>

        {isClosed ? (
          <div className="notice success">
            <CheckCircle2 size={18} />
            Mes fechado em {new Date(closing.closed_at).toLocaleString("pt-BR")}. A folha abaixo vem do snapshot arquivado.
          </div>
        ) : null}

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Dia</th>
                <th>Data</th>
                <th>Entrada</th>
                <th>Saida almoco</th>
                <th>Retorno almoco</th>
                <th>Saida</th>
                <th>Total</th>
                <th>Observacao</th>
              </tr>
            </thead>
            <tbody>
              {monthDays.map((day) => {
                const record = sheetRecordsByDate[day.key] || {};
                return (
                  <tr key={day.key} className={day.isWeekend ? "weekend" : ""}>
                    <td>{day.weekday}</td>
                    <td>{day.label}</td>
                    {TIME_FIELDS.map((field) => (
                      <td key={field}>
                        <input
                          type="time"
                          value={cleanTime(record[field])}
                          disabled={isClosed || !selectedUserId}
                          onChange={(event) => saveRecord(day.key, field, event.target.value)}
                        />
                      </td>
                    ))}
                    <td className="strong">{formatRecordDuration(record)}</td>
                    <td>
                      <input
                        value={record.observacao || ""}
                        disabled={isClosed || !selectedUserId}
                        onChange={(event) => saveRecord(day.key, "observacao", event.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <PrintSheet
        month={month}
        profile={selectedProfile}
        days={monthDays}
        recordsByDate={sheetRecordsByDate}
        monthTotal={monthTotal}
        closedAt={closing?.closed_at}
      />
    </main>
  );
}

function PrintSheet({ month, profile, days, recordsByDate, monthTotal, closedAt }) {
  return (
    <section className="print-sheet">
      <header className="print-header">
        <div>
          <h1>Folha de Ponto</h1>
          <p>{formatMonthLabel(month)}</p>
          {closedAt ? <p>Fechado em {new Date(closedAt).toLocaleString("pt-BR")}</p> : null}
        </div>
        <div>
          <p>
            <strong>Funcionario:</strong> {profile?.full_name || ""}
          </p>
          <p>
            <strong>Email:</strong> {profile?.email || ""}
          </p>
          <p>
            <strong>Cargo:</strong> {profile?.job_title || ""}
          </p>
        </div>
      </header>

      <table className="print-table">
        <thead>
          <tr>
            <th>Dia</th>
            <th>Data</th>
            <th>Entrada</th>
            <th>Saida almoco</th>
            <th>Retorno almoco</th>
            <th>Saida</th>
            <th>Total</th>
            <th>Observacao</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const record = recordsByDate[day.key] || {};
            return (
              <tr key={day.key}>
                <td>{day.weekday}</td>
                <td>{day.label}</td>
                {TIME_FIELDS.map((field) => (
                  <td key={field}>{cleanTime(record[field])}</td>
                ))}
                <td>{formatRecordDuration(record)}</td>
                <td>{record.observacao || ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan="6">Total do mes</td>
            <td>{formatDuration(monthTotal)}</td>
            <td></td>
          </tr>
        </tfoot>
      </table>

      <div className="signatures">
        <div>
          <span></span>
          Assinatura do funcionario
        </div>
        <div>
          <span></span>
          Responsavel
        </div>
      </div>
    </section>
  );
}
