"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Lock,
  LogOut,
  Plus,
  Printer,
  RefreshCcw,
  Save,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  TIME_FIELDS,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  formatRecordDuration,
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
  const monthRequestRef = useRef(0);
  const [profiles, setProfiles] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [month, setMonth] = useState(currentMonthKey());
  const [records, setRecords] = useState([]);
  const [draftRecords, setDraftRecords] = useState([]);
  const [closing, setClosing] = useState(null);
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [monthLoading, setMonthLoading] = useState(false);

  const employees = useMemo(() => {
    return profiles.filter((profile) => profile.role === "employee" && profile.active);
  }, [profiles]);

  const selectedProfile = employees.find((profile) => profile.id === selectedUserId);
  const monthDays = daysInMonth(month);
  const savedRecordsByDate = useMemo(() => {
    return Object.fromEntries(records.map((record) => [record.work_date, record]));
  }, [records]);
  const draftRecordsByDate = useMemo(() => {
    return Object.fromEntries(draftRecords.map((record) => [record.work_date, record]));
  }, [draftRecords]);
  const isClosed = Boolean(selectedProfile && closing) && records.length === 0;
  const sheetRecordsByDate = selectedProfile ? draftRecordsByDate : {};
  const monthTotal = selectedProfile
    ? isClosed
      ? closing?.total_minutes || totalMinutes(draftRecords)
      : totalMinutes(draftRecords)
    : 0;

  useEffect(() => {
    loadProfiles();
  }, []);

  useEffect(() => {
    if (selectedUserId) {
      loadMonth(selectedUserId, month);
      return;
    }

    monthRequestRef.current += 1;
    setRecords([]);
    setDraftRecords([]);
    setClosing(null);
    setMonthLoading(false);
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

    const list = data || [];
    const employeeList = list.filter((profile) => profile.role === "employee" && profile.active);
    const selectedStillAvailable = employeeList.some((profile) => profile.id === selectedUserId);

    setProfiles(list);
    if (!selectedStillAvailable) {
      setSelectedUserId(employeeList[0]?.id || "");
    }
  }

  async function loadMonth(userId = selectedUserId, targetMonth = month) {
    const requestId = monthRequestRef.current + 1;
    monthRequestRef.current = requestId;
    setMessage("");
    setMonthLoading(true);
    setRecords([]);
    setDraftRecords([]);
    setClosing(null);

    if (!userId) {
      setMonthLoading(false);
      return;
    }

    const [{ data: recordData, error: recordError }, { data: closingData, error: closingError }] =
      await Promise.all([
        supabase
          .from("time_records")
          .select("*")
          .eq("user_id", userId)
          .gte("work_date", monthStartKey(targetMonth))
          .lte("work_date", endOfMonthKey(targetMonth))
          .order("work_date", { ascending: true }),
        supabase
          .from("month_closings")
          .select("*")
          .eq("user_id", userId)
          .eq("month", monthStartKey(targetMonth))
          .maybeSingle(),
      ]);

    if (requestId !== monthRequestRef.current) {
      return;
    }

    setMonthLoading(false);

    if (recordError || closingError) {
      setMessage(recordError?.message || closingError?.message || "Nao foi possivel carregar a folha.");
      return;
    }

    const loadedRecords = recordData || [];
    setRecords(loadedRecords);
    setClosing(closingData || null);
    setDraftRecords(loadedRecords.length > 0 ? loadedRecords : closingData?.snapshot || []);
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

  function updateDraftRecord(dateKey, field, value) {
    if (!selectedProfile || isClosed) return;

    setDraftRecords((current) => {
      const existing = current.find((record) => record.work_date === dateKey);
      if (existing) {
        return current.map((record) =>
          record.work_date === dateKey ? { ...record, [field]: value } : record
        );
      }

      return [
        ...current,
        {
          user_id: selectedProfile.id,
          work_date: dateKey,
          entrada: "",
          saida_almoco: "",
          retorno_almoco: "",
          saida: "",
          observacao: "",
          [field]: value,
        },
      ];
    });
  }

  async function saveRecord(dateKey, field, value) {
    if (!selectedProfile || isClosed || monthLoading) return;

    const existing = savedRecordsByDate[dateKey];
    const normalizedValue = field === "observacao" ? value : value || null;
    const savedValue = field === "observacao" ? existing?.[field] || "" : cleanTime(existing?.[field]);
    const draftValue = field === "observacao" ? value || "" : value || "";

    if (!existing && !draftValue) return;
    if (existing && savedValue === draftValue) return;

    setMessage("");
    const payload = {
      user_id: selectedProfile.id,
      work_date: dateKey,
      [field]: normalizedValue,
    };

    const { data, error } = await supabase
      .from("time_records")
      .upsert(payload, { onConflict: "user_id,work_date" })
      .select("*")
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    replaceLocalRecord(data);
  }

  function replaceLocalRecord(data) {
    setRecords((current) => replaceRecord(current, data));
    setDraftRecords((current) => replaceRecord(current, data));
  }

  function replaceRecord(current, data) {
    const withoutRecord = current.filter((record) => record.work_date !== data.work_date);
    return [...withoutRecord, data].sort((a, b) => a.work_date.localeCompare(b.work_date));
  }

  async function closeMonth() {
    if (!selectedProfile || isClosed) return;
    const ok = window.confirm(
      "Fechar este mes vai salvar um snapshot e limpar os registros ativos. Confirma?"
    );

    if (!ok) return;

    setLoading(true);
    const { error } = await supabase.rpc("close_month", {
      p_user_id: selectedProfile.id,
      p_month: monthStartKey(month),
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Mes fechado e registros ativos limpos.");
    await loadMonth(selectedProfile.id, month);
  }

  async function closeAllMonths() {
    if (employees.length === 0 || loading || monthLoading) return;

    const ok = window.confirm(
      `Fechar ${formatMonthLabel(month)} de todos os ${employees.length} funcionarios ativos vai salvar snapshots e limpar os registros ativos. Confirma?`
    );

    if (!ok) return;

    const targetMonth = monthStartKey(month);
    const employeeIds = employees.map((employee) => employee.id);

    setLoading(true);
    setMessage("");

    const { data: existingClosings, error: closingError } = await supabase
      .from("month_closings")
      .select("user_id")
      .eq("month", targetMonth)
      .in("user_id", employeeIds);

    if (closingError) {
      setLoading(false);
      setMessage(closingError.message);
      return;
    }

    const closedUserIds = new Set((existingClosings || []).map((row) => row.user_id));
    const pendingEmployees = employees.filter((employee) => !closedUserIds.has(employee.id));
    const errors = [];
    let closedCount = 0;

    for (const employee of pendingEmployees) {
      const { error } = await supabase.rpc("close_month", {
        p_user_id: employee.id,
        p_month: targetMonth,
      });

      if (error) {
        errors.push(`${employee.full_name || employee.email}: ${error.message}`);
        continue;
      }

      closedCount += 1;
    }

    setLoading(false);

    if (selectedProfile) {
      await loadMonth(selectedProfile.id, month);
    }

    const skippedCount = employees.length - pendingEmployees.length;
    const summary = [];

    if (closedCount > 0) {
      summary.push(
        `${closedCount} funcionario${closedCount === 1 ? "" : "s"} fechado${closedCount === 1 ? "" : "s"}`
      );
    }

    if (skippedCount > 0) {
      summary.push(
        `${skippedCount} ja estava${skippedCount === 1 ? "" : "m"} fechado${skippedCount === 1 ? "" : "s"}`
      );
    }

    if (errors.length > 0) {
      summary.push(
        `${errors.length} erro${errors.length === 1 ? "" : "s"}: ${errors.slice(0, 3).join(" | ")}`
      );
    }

    setMessage(summary.join(". ") || "Nenhum funcionario pendente para fechar.");
  }
  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function selectProfile(profile) {
    if (profile.role === "employee" && profile.active) {
      setSelectedUserId(profile.id);
      return;
    }

    setMessage("Administradores e usuarios inativos nao possuem folha de ponto.");
  }

  function printSheet() {
    if (!selectedProfile) return;
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
          <button
            className="secondary"
            type="button"
            onClick={() => loadMonth()}
            disabled={!selectedProfile || monthLoading}
          >
            <RefreshCcw size={18} />
            Atualizar
          </button>
          <button
            className="secondary"
            type="button"
            onClick={printSheet}
            disabled={!selectedProfile}
          >
            <Printer size={18} />
            Imprimir folha
          </button>
          <button
            className="primary"
            type="button"
            onClick={closeMonth}
            disabled={loading || !selectedProfile || isClosed || monthLoading}
          >
            <Lock size={18} />
            Fechar mes
          </button>
          <button
            className="secondary"
            type="button"
            onClick={closeAllMonths}
            disabled={loading || monthLoading || employees.length === 0}
          >
            <Users size={18} />
            Fechar todos
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
            <span className="muted">
              {employees.length} funcionarios ativos de {profiles.length} usuarios
            </span>
          </div>
          <div className="people-list">
            {profiles.map((profile) => {
              const canSelectSheet = profile.role === "employee" && profile.active;
              return (
                <div
                  className={`person-row ${canSelectSheet && profile.id === selectedUserId ? "selected" : ""}`}
                  key={profile.id}
                >
                  <button type="button" onClick={() => selectProfile(profile)}>
                    <strong>{profile.full_name || profile.email}</strong>
                    <span>
                      {profile.email} - {profile.role === "admin" ? "admin" : "funcionario"}
                      {!profile.active ? " inativo" : ""}
                    </span>
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
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Folha mensal</h2>
            <p className="muted">
              {selectedProfile?.full_name || "Selecione um funcionario"} - {formatMonthLabel(month)}
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

        {!selectedProfile ? (
          <div className="notice">Cadastre ou ative um funcionario para lancar a folha de ponto.</div>
        ) : null}

        {monthLoading ? (
          <div className="notice">Carregando folha do funcionario selecionado...</div>
        ) : null}

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
                          disabled={isClosed || !selectedProfile || monthLoading}
                          onChange={(event) => updateDraftRecord(day.key, field, event.target.value)}
                          onBlur={(event) => saveRecord(day.key, field, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") event.currentTarget.blur();
                          }}
                        />
                      </td>
                    ))}
                    <td className="strong">{formatRecordDuration(record)}</td>
                    <td>
                      <input
                        value={record.observacao || ""}
                        disabled={isClosed || !selectedProfile || monthLoading}
                        onChange={(event) => updateDraftRecord(day.key, "observacao", event.target.value)}
                        onBlur={(event) => saveRecord(day.key, "observacao", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
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
