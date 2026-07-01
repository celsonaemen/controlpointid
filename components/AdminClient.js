"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileText,
  KeyRound,
  Lock,
  LogOut,
  Plus,
  Printer,
  Download,
  RefreshCcw,
  Save,
  Trash2,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  TIME_FIELDS,
  WEEKDAYS,
  analyzeMonth,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  formatRecordDuration,
  formatSignedDuration,
  monthStartKey,
  profileExpectedDailyMinutes,
  profileExpectedEndTime,
  profileExpectedStartTime,
  profileWorkdays,
  totalMinutes,
} from "@/lib/date";

const WORKDAY_OPTIONS = [1, 2, 3, 4, 5, 6, 0];

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
  const [activeTab, setActiveTab] = useState("sheet");
  const [profiles, setProfiles] = useState([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [month, setMonth] = useState(currentMonthKey());
  const [records, setRecords] = useState([]);
  const [draftRecords, setDraftRecords] = useState([]);
  const [closing, setClosing] = useState(null);
  const [approval, setApproval] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);
  const [passwordEdits, setPasswordEdits] = useState({});
  const [passwordLoading, setPasswordLoading] = useState("");
  const [credentialPrint, setCredentialPrint] = useState(null);
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [deleteModalProfile, setDeleteModalProfile] = useState(null);
  const [deletePrintSheet, setDeletePrintSheet] = useState(null);
  const [accessLogs, setAccessLogs] = useState([]);
  const [accessMonth, setAccessMonth] = useState(currentMonthKey());
  const [accessUserId, setAccessUserId] = useState("");
  const [accessLoading, setAccessLoading] = useState(false);
  const [printTarget, setPrintTarget] = useState(null);
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
  const monthSummary = selectedProfile ? analyzeMonth(monthDays, sheetRecordsByDate, selectedProfile) : null;

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
    setApproval(null);
    setAuditLogs([]);
    setMonthLoading(false);
  }, [selectedUserId, month]);

  useEffect(() => {
    if (activeTab === "access") {
      loadAccessLogs();
    }
  }, [activeTab, accessMonth, accessUserId]);

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

    const [
      { data: recordData, error: recordError },
      { data: closingData, error: closingError },
      { data: approvalData, error: approvalError },
    ] = await Promise.all([
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
      supabase
        .from("timesheet_approvals")
        .select("*")
        .eq("user_id", userId)
        .eq("month", monthStartKey(targetMonth))
        .maybeSingle(),
    ]);

    if (requestId !== monthRequestRef.current) return;
    setMonthLoading(false);

    if (recordError || closingError || approvalError) {
      setMessage(recordError?.message || closingError?.message || approvalError?.message || "Nao foi possivel carregar a folha.");
      return;
    }

    const loadedRecords = recordData || [];
    setRecords(loadedRecords);
    setClosing(closingData || null);
    setApproval(approvalData || null);
    setDraftRecords(loadedRecords.length > 0 ? loadedRecords : closingData?.snapshot || []);
    loadAuditLogs(userId, targetMonth);
  }

  async function loadAuditLogs(userId = selectedUserId, targetMonth = month) {
    if (!userId) {
      setAuditLogs([]);
      return;
    }

    setAuditLoading(true);
    const params = new URLSearchParams({ month: targetMonth, user_id: userId });
    const response = await fetch(`/api/admin/audit-logs?${params.toString()}`);
    const result = await response.json();
    setAuditLoading(false);

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel carregar a auditoria.");
      return;
    }

    setAuditLogs(result.logs || []);
  }
  async function loadAccessLogs() {
    setAccessLoading(true);
    setMessage("");
    const params = new URLSearchParams({ month: accessMonth });
    if (accessUserId) params.set("user_id", accessUserId);

    const response = await fetch(`/api/admin/access-logs?${params.toString()}`);
    const result = await response.json();
    setAccessLoading(false);

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel carregar o relatorio.");
      return;
    }

    setAccessLogs(result.logs || []);
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
      return false;
    }

    setMessage("Usuario atualizado.");
    await loadProfiles();
    return true;
  }

  async function updateProfileField(profile, field, value) {
    const normalizedValue = field === "email" ? String(value || "").trim().toLowerCase() : String(value || "").trim();
    const currentValue = profile[field] || "";
    if (normalizedValue === currentValue) return;
    await updateProfile(profile.id, { [field]: normalizedValue });
  }

  function openDeleteProfile(profile) {
    if (profile.id === adminProfile.id) {
      setMessage("Voce nao pode apagar seu proprio usuario.");
      return;
    }

    setMessage("");
    setDeleteModalProfile(profile);
  }

  async function performDeleteProfile(profile, successMessage = "Usuario apagado.") {
    if (!profile) return;

    setDeletingProfileId(profile.id);
    setMessage("");
    const response = await fetch(`/api/admin/employees/${profile.id}`, { method: "DELETE" });
    const result = await response.json();
    setDeletingProfileId("");

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel apagar o usuario.");
      return;
    }

    if (selectedUserId === profile.id) setSelectedUserId("");
    setDeleteModalProfile(null);
    setDeletePrintSheet(null);
    setPrintTarget(null);
    setMessage(successMessage);
    await loadProfiles();
  }

  async function loadPrintableSheet(profile) {
    const targetMonth = month;
    const [{ data: recordData, error: recordError }, { data: closingData, error: closingError }] =
      await Promise.all([
        supabase
          .from("time_records")
          .select("*")
          .eq("user_id", profile.id)
          .gte("work_date", monthStartKey(targetMonth))
          .lte("work_date", endOfMonthKey(targetMonth))
          .order("work_date", { ascending: true }),
        supabase
          .from("month_closings")
          .select("*")
          .eq("user_id", profile.id)
          .eq("month", monthStartKey(targetMonth))
          .maybeSingle(),
      ]);

    if (recordError || closingError) {
      throw new Error(recordError?.message || closingError?.message || "Nao foi possivel carregar a folha para imprimir.");
    }

    const activeRecords = recordData || [];
    const printableRecords = activeRecords.length > 0 ? activeRecords : closingData?.snapshot || [];

    return {
      month: targetMonth,
      profile,
      days: daysInMonth(targetMonth),
      recordsByDate: Object.fromEntries(printableRecords.map((record) => [record.work_date, record])),
      monthTotal: closingData && activeRecords.length === 0
        ? closingData.total_minutes || totalMinutes(printableRecords)
        : totalMinutes(printableRecords),
      closedAt: closingData?.closed_at,
    };
  }

  function waitForPrintDialog() {
    return new Promise((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.removeEventListener("afterprint", finish);
        resolve();
      };

      window.addEventListener("afterprint", finish, { once: true });
      window.setTimeout(() => {
        window.print();
        window.setTimeout(finish, 500);
      }, 0);
    });
  }

  async function printAndDeleteProfile(profile) {
    if (!profile || deletingProfileId) return;

    setDeletingProfileId(profile.id);
    setMessage("Preparando folha para impressao...");

    try {
      const printableSheet = await loadPrintableSheet(profile);
      setDeletePrintSheet(printableSheet);
      setPrintTarget("delete-sheet");
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      await waitForPrintDialog();
      setPrintTarget(null);
      setDeletePrintSheet(null);
      await performDeleteProfile(profile, "Folha enviada para impressao e usuario apagado.");
    } catch (error) {
      setDeletingProfileId("");
      setPrintTarget(null);
      setDeletePrintSheet(null);
      setMessage(error.message || "Nao foi possivel imprimir e apagar o usuario.");
    }
  }

  async function deleteProfile(profile) {
    await performDeleteProfile(profile);
  }

  async function changePassword(profile) {
    const password = String(passwordEdits[profile.id] || "").trim();

    if (password.length < 6) {
      setMessage("A nova senha precisa ter pelo menos 6 caracteres.");
      return;
    }

    const ok = window.confirm(`Alterar a senha de ${profile.full_name || profile.email}?`);
    if (!ok) return;

    const success = await updateUserPassword(profile, password);
    if (!success) return;

    setPasswordEdits((current) => ({ ...current, [profile.id]: "" }));

    if (profile.id === adminProfile.id) {
      setMessage("Senha alterada. Entre novamente com a nova senha.");
      await supabase.auth.signOut();
      window.location.href = "/login?password_changed=1";
      return;
    }

    setMessage(`Senha alterada para ${profile.full_name || profile.email}.`);
  }

  async function updateUserPassword(profile, password) {
    setPasswordLoading(profile.id);
    setMessage("");
    const response = await fetch(`/api/admin/employees/${profile.id}/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    const result = await response.json();
    setPasswordLoading("");

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel alterar a senha.");
      return false;
    }

    return true;
  }

  async function printUserCredentials(profile) {
    let password = String(passwordEdits[profile.id] || "").trim();

    if (!password) {
      const typedPassword = window.prompt("Digite a senha que vai constar na ficha de acesso. Ela sera definida como nova senha do usuario.");
      if (typedPassword === null) return;
      password = typedPassword.trim();
    }

    if (password.length < 6) {
      setMessage("A senha da ficha precisa ter pelo menos 6 caracteres.");
      return;
    }

    const ok = window.confirm(`Imprimir a ficha de ${profile.full_name || profile.email} e definir esta senha como senha de acesso?`);
    if (!ok) return;

    const success = await updateUserPassword(profile, password);
    if (!success) return;

    setPasswordEdits((current) => ({ ...current, [profile.id]: "" }));
    setCredentialPrint({ profile, password, generatedAt: new Date().toISOString() });
    setPrintTarget("credentials");
    setMessage(`Ficha de acesso preparada para ${profile.full_name || profile.email}.`);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(async () => {
        setPrintTarget(null);
        setCredentialPrint(null);
        if (profile.id === adminProfile.id) {
          await supabase.auth.signOut();
          window.location.href = "/login?password_changed=1";
        }
      }, 300);
    }, 0);
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

  async function updateExpectedHours(profile, value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24) {
      setMessage("Jornada diaria invalida.");
      return;
    }
    await updateProfile(profile.id, { expected_daily_minutes: Math.round(hours * 60) });
  }

  async function toggleWorkday(profile, day) {
    const current = profileWorkdays(profile);
    const next = current.includes(day)
      ? current.filter((item) => item !== day)
      : [...current, day].sort((a, b) => a - b);

    if (next.length === 0) {
      setMessage("A escala precisa ter pelo menos um dia de trabalho.");
      return;
    }

    await updateProfile(profile.id, { workdays: next });
  }

  function exportSheetCsv() {
    if (!selectedProfile) return;

    const rows = [
      ["Funcionario", selectedProfile.full_name || selectedProfile.email],
      ["Email", selectedProfile.email || ""],
      ["Cargo", selectedProfile.job_title || ""],
      ["Mes", formatMonthLabel(month)],
      ["Total", formatDuration(monthTotal)],
      ["Banco de horas", monthSummary ? formatSignedDuration(monthSummary.balanceMinutes) : "00:00"],
      [],
      ["Dia", "Data", "Entrada", "Saida almoco", "Retorno almoco", "Saida", "Total", "Observacao"],
      ...monthDays.map((day) => {
        const record = sheetRecordsByDate[day.key] || {};
        return [
          day.weekday,
          day.label,
          cleanTime(record.entrada),
          cleanTime(record.saida_almoco),
          cleanTime(record.retorno_almoco),
          cleanTime(record.saida),
          formatRecordDuration(record),
          record.observacao || "",
        ];
      }),
    ];

    downloadCsv(`folha-${selectedProfile.full_name || selectedProfile.email}-${month}.csv`, rows);
  }

  function exportAccessCsv() {
    const rows = [
      ["Usuario", "Email", "Perfil", "Data", "Login", "Ultima atividade", "Minutos", "IP"],
      ...accessLogs.map((log) => [
        log.profile?.full_name || "Usuario removido",
        log.profile?.email || "",
        log.profile?.role === "admin" ? "admin" : "funcionario",
        formatAccessDate(log.login_at),
        formatAccessTime(log.login_at),
        formatAccessTime(log.last_seen_at),
        `${log.duration_minutes}`,
        log.ip_address || "",
      ]),
    ];

    downloadCsv(`relatorio-acessos-${accessMonth}.csv`, rows);
  }
  async function closeMonth() {
    if (!selectedProfile || isClosed) return;
    const confirmMessage = approval
      ? "Fechar este mes vai salvar um snapshot e limpar os registros ativos. Confirma?"
      : "Este funcionario ainda nao confirmou a folha do mes. Deseja fechar mesmo assim?";
    const ok = window.confirm(confirmMessage);
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
    if (selectedProfile) await loadMonth(selectedProfile.id, month);

    const skippedCount = employees.length - pendingEmployees.length;
    const summary = [];
    if (closedCount > 0) summary.push(`${closedCount} funcionario${closedCount === 1 ? "" : "s"} fechado${closedCount === 1 ? "" : "s"}`);
    if (skippedCount > 0) summary.push(`${skippedCount} ja estava${skippedCount === 1 ? "" : "m"} fechado${skippedCount === 1 ? "" : "s"}`);
    if (errors.length > 0) summary.push(`${errors.length} erro${errors.length === 1 ? "" : "s"}: ${errors.slice(0, 3).join(" | ")}`);
    setMessage(summary.join(". ") || "Nenhum funcionario pendente para fechar.");
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function selectProfile(profile) {
    if (profile.role === "employee" && profile.active) {
      setSelectedUserId(profile.id);
      setActiveTab("sheet");
      return;
    }
    setMessage("Administradores e usuarios inativos nao possuem folha de ponto.");
  }

  function printWithTarget(target) {
    setPrintTarget(target);
    window.setTimeout(() => {
      window.print();
      window.setTimeout(() => setPrintTarget(null), 300);
    }, 0);
  }

  function printSheet() {
    if (!selectedProfile) return;
    printWithTarget("sheet");
  }

  function printAccessReport() {
    printWithTarget("access");
  }

  function refreshActiveTab() {
    if (activeTab === "access") return loadAccessLogs();
    if (activeTab === "users") return loadProfiles();
    return loadMonth();
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
          <button className="secondary" type="button" onClick={refreshActiveTab}>
            <RefreshCcw size={18} />
            Atualizar
          </button>
          {activeTab === "sheet" ? (
            <>
              <button className="secondary" type="button" onClick={printSheet} disabled={!selectedProfile}>
                <Printer size={18} />
                Imprimir folha
              </button>
              <button className="secondary" type="button" onClick={exportSheetCsv} disabled={!selectedProfile}>
                <Download size={18} />
                Exportar CSV
              </button>
            </>
          ) : null}
          {activeTab === "access" ? (
            <>
              <button className="secondary" type="button" onClick={printAccessReport}>
                <Printer size={18} />
                Imprimir relatorio
              </button>
              <button className="secondary" type="button" onClick={exportAccessCsv}>
                <Download size={18} />
                Exportar CSV
              </button>
            </>
          ) : null}
          {activeTab === "sheet" ? (
            <>
              <button className="primary" type="button" onClick={closeMonth} disabled={loading || !selectedProfile || isClosed || monthLoading}>
                <Lock size={18} />
                Fechar mes
              </button>
              <button className="secondary" type="button" onClick={closeAllMonths} disabled={loading || monthLoading || employees.length === 0}>
                <Users size={18} />
                Fechar todos
              </button>
            </>
          ) : null}
          <button className="secondary icon-only" type="button" onClick={signOut} title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <nav className="admin-tabs" aria-label="Areas do painel admin">
        <button className={activeTab === "sheet" ? "active" : ""} type="button" onClick={() => setActiveTab("sheet")}>
          <FileText size={18} />
          Folha mensal
        </button>
        <button className={activeTab === "users" ? "active" : ""} type="button" onClick={() => setActiveTab("users")}>
          <Users size={18} />
          Usuarios
        </button>
        <button className={activeTab === "access" ? "active" : ""} type="button" onClick={() => setActiveTab("access")}>
          <FileText size={18} />
          Relatorio de acessos
        </button>
      </nav>

      {message ? <div className="notice">{message}</div> : null}

      {activeTab === "users" ? (
        <section className="admin-grid">
          <form className="panel form-panel" onSubmit={createEmployee}>
            <div className="panel-heading">
              <h2>Novo usuario</h2>
              <Plus size={20} />
            </div>
            <label>
              Nome
              <input value={newEmployee.full_name} onChange={(event) => setNewEmployee({ ...newEmployee, full_name: event.target.value })} required />
            </label>
            <label>
              Email
              <input type="email" value={newEmployee.email} onChange={(event) => setNewEmployee({ ...newEmployee, email: event.target.value })} required />
            </label>
            <label>
              Senha inicial
              <input type="password" minLength={6} value={newEmployee.password} onChange={(event) => setNewEmployee({ ...newEmployee, password: event.target.value })} required />
            </label>
            <label>
              Cargo
              <input value={newEmployee.job_title} onChange={(event) => setNewEmployee({ ...newEmployee, job_title: event.target.value })} />
            </label>
            <label>
              Perfil
              <select value={newEmployee.role} onChange={(event) => setNewEmployee({ ...newEmployee, role: event.target.value })}>
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
              <span className="muted">{employees.length} funcionarios ativos de {profiles.length} usuarios</span>
            </div>
            <div className="people-list">
              {profiles.map((profile) => {
                const canSelectSheet = profile.role === "employee" && profile.active;
                return (
                  <div className={`person-row ${canSelectSheet && profile.id === selectedUserId ? "selected" : ""}`} key={profile.id}>
                    <button className="person-select" type="button" onClick={() => selectProfile(profile)}>
                      <strong>{profile.full_name || profile.email}</strong>
                      <span>{profile.email} - {profile.role === "admin" ? "admin" : "funcionario"}{!profile.active ? " inativo" : ""}</span>
                    </button>
                    <div className="person-edit-grid">
                      <label>
                        Nome
                        <input defaultValue={profile.full_name || ""} onBlur={(event) => updateProfileField(profile, "full_name", event.currentTarget.value)} />
                      </label>
                      <label>
                        Email
                        <input type="email" defaultValue={profile.email || ""} onBlur={(event) => updateProfileField(profile, "email", event.currentTarget.value)} />
                      </label>
                      <label>
                        Cargo
                        <input defaultValue={profile.job_title || ""} onBlur={(event) => updateProfileField(profile, "job_title", event.currentTarget.value)} />
                      </label>
                      <label>
                        Jornada/dia
                        <input type="number" min="0" max="24" step="0.25" defaultValue={minutesToHours(profileExpectedDailyMinutes(profile))} onBlur={(event) => updateExpectedHours(profile, event.currentTarget.value)} />
                      </label>
                      <label>
                        Entrada padrao
                        <input type="time" defaultValue={profileExpectedStartTime(profile)} onBlur={(event) => updateProfile(profile.id, { expected_start_time: event.currentTarget.value })} />
                      </label>
                      <label>
                        Saida padrao
                        <input type="time" defaultValue={profileExpectedEndTime(profile)} onBlur={(event) => updateProfile(profile.id, { expected_end_time: event.currentTarget.value })} />
                      </label>
                    </div>
                    <div className="workday-toggle" aria-label="Dias de trabalho">
                      {WORKDAY_OPTIONS.map((day) => (
                        <button className={profileWorkdays(profile).includes(day) ? "active" : ""} type="button" key={day} onClick={() => toggleWorkday(profile, day)}>
                          {WEEKDAYS[day]}
                        </button>
                      ))}
                    </div>
                    <select value={profile.role} onChange={(event) => updateProfile(profile.id, { role: event.target.value })}>
                      <option value="employee">Funcionario</option>
                      <option value="admin">Admin</option>
                    </select>
                    <label className="inline-check">
                      <input type="checkbox" checked={profile.active} onChange={(event) => updateProfile(profile.id, { active: event.target.checked })} />
                      Ativo
                    </label>
                    <button className="danger-button" type="button" onClick={() => openDeleteProfile(profile)} disabled={deletingProfileId === profile.id || profile.id === adminProfile.id}>
                      <Trash2 size={16} />
                      {deletingProfileId === profile.id ? "Apagando..." : "Apagar"}
                    </button>
                    <div className="password-reset">
                      <input type="password" minLength={6} placeholder="Nova senha / ficha" value={passwordEdits[profile.id] || ""} onChange={(event) => setPasswordEdits((current) => ({ ...current, [profile.id]: event.target.value }))} />
                      <button className="secondary" type="button" onClick={() => changePassword(profile)} disabled={passwordLoading === profile.id || !(passwordEdits[profile.id] || "").trim()}>
                        <KeyRound size={16} />
                        {passwordLoading === profile.id ? "Alterando..." : "Alterar senha"}
                      </button>
                      <button className="secondary" type="button" onClick={() => printUserCredentials(profile)} disabled={passwordLoading === profile.id}>
                        <Printer size={16} />
                        Imprimir acesso
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </section>
      ) : null}
      {activeTab === "sheet" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Folha mensal</h2>
              <p className="muted">{selectedProfile?.full_name || "Selecione um funcionario"} - {formatMonthLabel(month)}</p>
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


          {employees.length > 0 ? (
            <div className="sheet-people-list" aria-label="Funcionarios da folha">
              {employees.map((employee) => (
                <button
                  className={`sheet-person ${employee.id === selectedUserId ? "active" : ""}`}
                  type="button"
                  key={employee.id}
                  onClick={() => selectProfile(employee)}
                >
                  <strong>{employee.full_name || employee.email}</strong>
                  <span>{employee.job_title || employee.email}</span>
                </button>
              ))}
            </div>
          ) : null}

          {!selectedProfile ? <div className="notice">Cadastre ou ative um funcionario para lancar a folha de ponto.</div> : null}
          {monthLoading ? <div className="notice">Carregando folha do funcionario selecionado...</div> : null}
          {isClosed ? (
            <div className="notice success">
              <CheckCircle2 size={18} />
              Mes fechado em {new Date(closing.closed_at).toLocaleString("pt-BR")}. A folha abaixo vem do snapshot arquivado.
            </div>
          ) : null}


          {selectedProfile && monthSummary ? (
            <div className="summary-panel-inline">
              <div className="summary-grid">
                <div className="summary-card"><span>Pendencias</span><strong>{monthSummary.pending}</strong></div>
                <div className="summary-card"><span>Faltas</span><strong>{monthSummary.absences}</strong></div>
                <div className="summary-card"><span>Incompletos</span><strong>{monthSummary.incomplete}</strong></div>
                <div className="summary-card"><span>Invalidos</span><strong>{monthSummary.invalid}</strong></div>
                <div className="summary-card"><span>Atrasos</span><strong>{monthSummary.late}</strong></div>
                <div className="summary-card"><span>Horas extras</span><strong>{formatDuration(monthSummary.overtimeMinutes)}</strong></div>
                <div className={`summary-card ${monthSummary.balanceMinutes < 0 ? "danger" : ""}`}><span>Banco de horas</span><strong>{formatSignedDuration(monthSummary.balanceMinutes)}</strong></div>
              </div>
              {approval ? (
                <div className="notice success">Folha confirmada pelo funcionario em {new Date(approval.approved_at).toLocaleString("pt-BR")}.</div>
              ) : (
                <div className="notice">Funcionario ainda nao confirmou a folha deste mes.</div>
              )}
              {monthSummary.issues.length > 0 ? (
                <div className="issue-list">
                  {monthSummary.issues.slice(0, 8).map((issue) => (
                    <span key={`${issue.type}-${issue.date}`}>{issue.label}: {issue.detail}</span>
                  ))}
                </div>
              ) : null}
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
                          <input type="time" value={cleanTime(record[field])} disabled={isClosed || !selectedProfile || monthLoading} onChange={(event) => updateDraftRecord(day.key, field, event.target.value)} onBlur={(event) => saveRecord(day.key, field, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                        </td>
                      ))}
                      <td className="strong">{formatRecordDuration(record)}</td>
                      <td>
                        <input value={record.observacao || ""} disabled={isClosed || !selectedProfile || monthLoading} onChange={(event) => updateDraftRecord(day.key, "observacao", event.target.value)} onBlur={(event) => saveRecord(day.key, "observacao", event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedProfile ? (
            <section className="audit-box">
              <div className="panel-heading">
                <div>
                  <h2>Auditoria de alteracoes</h2>
                  <p className="muted">Ultimos lancamentos e correcoes da folha selecionada.</p>
                </div>
                <button className="secondary" type="button" onClick={() => loadAuditLogs(selectedProfile.id, month)} disabled={auditLoading}>
                  <RefreshCcw size={16} />
                  Atualizar auditoria
                </button>
              </div>
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Acao</th>
                      <th>Dia</th>
                      <th>Autor</th>
                      <th>Alteracao</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? <tr><td colSpan="5">Nenhuma alteracao registrada para este filtro.</td></tr> : null}
                    {auditLogs.map((log) => (
                      <tr key={log.id}>
                        <td>{new Date(log.created_at).toLocaleString("pt-BR")}</td>
                        <td>{formatAuditAction(log.action)}</td>
                        <td>{auditWorkDate(log)}</td>
                        <td>{log.actor?.full_name || log.actor?.email || "Sistema"}</td>
                        <td>{formatAuditChanges(log)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      {activeTab === "access" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Relatorio de acessos</h2>
              <p className="muted">Entradas no sistema e tempo aproximado de uso.</p>
            </div>
            <div className="report-controls">
              <label>
                Mes
                <input type="month" value={accessMonth} onChange={(event) => setAccessMonth(event.target.value)} />
              </label>
              <label>
                Usuario
                <select value={accessUserId} onChange={(event) => setAccessUserId(event.target.value)}>
                  <option value="">Todos</option>
                  {profiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>{profile.full_name || profile.email}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {accessLoading ? <div className="notice">Carregando relatorio...</div> : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Usuario</th>
                  <th>Email</th>
                  <th>Perfil</th>
                  <th>Data</th>
                  <th>Login</th>
                  <th>Ultima atividade</th>
                  <th>Minutos</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {accessLogs.length === 0 ? (
                  <tr><td colSpan="8">Nenhum acesso encontrado para o filtro.</td></tr>
                ) : null}
                {accessLogs.map((log) => (
                  <tr key={log.id}>
                    <td>{log.profile?.full_name || "Usuario removido"}</td>
                    <td>{log.profile?.email || ""}</td>
                    <td>{log.profile?.role === "admin" ? "admin" : "funcionario"}</td>
                    <td>{formatAccessDate(log.login_at)}</td>
                    <td>{formatAccessTime(log.login_at)}</td>
                    <td>{formatAccessTime(log.last_seen_at)}</td>
                    <td className="strong">{log.duration_minutes} min</td>
                    <td>{log.ip_address || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {deleteModalProfile ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="delete-user-title">
          <section className="modal-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Acao permanente</p>
                <h2 id="delete-user-title">Apagar usuario</h2>
              </div>
              <Trash2 size={22} />
            </div>
            <p className="modal-copy">
              Voce esta apagando {deleteModalProfile.full_name || deleteModalProfile.email}. Para preservar historico, prefira desativar o usuario no campo Ativo.
            </p>
            <p className="modal-copy">
              Se continuar, os dados vinculados ao usuario podem ser removidos. Deseja imprimir a folha de {formatMonthLabel(month)} antes de apagar?
            </p>
            <div className="modal-actions">
              <button className="secondary" type="button" onClick={() => setDeleteModalProfile(null)} disabled={Boolean(deletingProfileId)}>
                Cancelar
              </button>
              <button className="secondary" type="button" onClick={() => printAndDeleteProfile(deleteModalProfile)} disabled={Boolean(deletingProfileId)}>
                <Printer size={16} />
                Imprimir mes e apagar
              </button>
              <button className="danger-button" type="button" onClick={() => deleteProfile(deleteModalProfile)} disabled={Boolean(deletingProfileId)}>
                <Trash2 size={16} />
                {deletingProfileId ? "Apagando..." : "Apagar sem imprimir"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {printTarget === "sheet" ? <PrintSheet month={month} profile={selectedProfile} days={monthDays} recordsByDate={sheetRecordsByDate} monthTotal={monthTotal} closedAt={closing?.closed_at} /> : null}
      {printTarget === "access" ? <PrintAccessReport month={accessMonth} logs={accessLogs} /> : null}
      {printTarget === "credentials" && credentialPrint ? <PrintCredentials data={credentialPrint} /> : null}
      {printTarget === "delete-sheet" && deletePrintSheet ? <PrintSheet {...deletePrintSheet} /> : null}
    </main>
  );
}

function minutesToHours(minutes) {
  return (minutes / 60).toFixed(2).replace(/\.00$/, "");
}

function escapeCsvCell(value) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(";")).join("\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.replace(/[\\/:*?"<>|]+/g, "-");
  link.click();
  URL.revokeObjectURL(url);
}

function auditPayload(log) {
  return log.new_data || log.old_data || {};
}

function auditWorkDate(log) {
  return auditPayload(log).work_date || "";
}

function formatAuditAction(action) {
  if (action === "INSERT") return "Lancamento";
  if (action === "UPDATE") return "Correcao";
  if (action === "DELETE") return "Exclusao";
  return action || "Alteracao";
}

function formatAuditChanges(log) {
  if (log.action === "INSERT") return "Registro criado.";
  if (log.action === "DELETE") return "Registro apagado.";

  const oldData = log.old_data || {};
  const newData = log.new_data || {};
  const fields = [...TIME_FIELDS, "observacao"];
  const changes = fields
    .filter((field) => String(oldData[field] || "") !== String(newData[field] || ""))
    .map((field) => `${field}: ${cleanTime(oldData[field]) || oldData[field] || "--"} -> ${cleanTime(newData[field]) || newData[field] || "--"}`);

  return changes.join(" | ") || "Registro atualizado.";
}
function formatAccessDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("pt-BR");
}

function formatAccessTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function PrintCredentials({ data }) {
  const profile = data?.profile || {};

  return (
    <section className="print-sheet print-credentials">
      <header className="print-header">
        <div>
          <h1>Ficha de Acesso</h1>
          <p>ControlPoint ID</p>
        </div>
        <div><p><strong>Gerado em:</strong> {new Date(data.generatedAt).toLocaleString("pt-BR")}</p></div>
      </header>
      <div className="credential-card">
        <p><strong>Nome:</strong> {profile.full_name || ""}</p>
        <p><strong>Email de acesso:</strong> {profile.email || ""}</p>
        <p><strong>Senha:</strong> {data.password}</p>
        <p><strong>Perfil:</strong> {profile.role === "admin" ? "Administrador" : "Funcionario"}</p>
        <p><strong>Cargo:</strong> {profile.job_title || ""}</p>
        <p><strong>Sistema:</strong> https://controlpointid.vercel.app</p>
      </div>
      <div className="credential-note">
        Esta ficha contem dados de acesso. Entregue somente ao usuario responsavel e oriente a guarda em local seguro.
      </div>
    </section>
  );
}
function PrintAccessReport({ month, logs }) {
  return (
    <section className="print-sheet">
      <header className="print-header">
        <div>
          <h1>Relatorio de Acessos</h1>
          <p>{formatMonthLabel(month)}</p>
        </div>
        <div><p><strong>Gerado em:</strong> {new Date().toLocaleString("pt-BR")}</p></div>
      </header>
      <table className="print-table">
        <thead>
          <tr>
            <th>Usuario</th>
            <th>Email</th>
            <th>Perfil</th>
            <th>Data</th>
            <th>Login</th>
            <th>Ultima atividade</th>
            <th>Minutos</th>
          </tr>
        </thead>
        <tbody>
          {logs.map((log) => (
            <tr key={log.id}>
              <td>{log.profile?.full_name || "Usuario removido"}</td>
              <td>{log.profile?.email || ""}</td>
              <td>{log.profile?.role === "admin" ? "admin" : "funcionario"}</td>
              <td>{formatAccessDate(log.login_at)}</td>
              <td>{formatAccessTime(log.login_at)}</td>
              <td>{formatAccessTime(log.last_seen_at)}</td>
              <td>{log.duration_minutes} min</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
          <p><strong>Funcionario:</strong> {profile?.full_name || ""}</p>
          <p><strong>Email:</strong> {profile?.email || ""}</p>
          <p><strong>Cargo:</strong> {profile?.job_title || ""}</p>
        </div>
      </header>
      <table className="print-table">
        <thead>
          <tr>
            <th>Dia</th><th>Data</th><th>Entrada</th><th>Saida almoco</th><th>Retorno almoco</th><th>Saida</th><th>Total</th><th>Observacao</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => {
            const record = recordsByDate[day.key] || {};
            return (
              <tr key={day.key}>
                <td>{day.weekday}</td><td>{day.label}</td>
                {TIME_FIELDS.map((field) => <td key={field}>{cleanTime(record[field])}</td>)}
                <td>{formatRecordDuration(record)}</td><td>{record.observacao || ""}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot><tr><td colSpan="6">Total do mes</td><td>{formatDuration(monthTotal)}</td><td></td></tr></tfoot>
      </table>
      <div className="signatures">
        <div><span></span>Assinatura do funcionario</div>
        <div><span></span>Responsavel</div>
      </div>
    </section>
  );
}