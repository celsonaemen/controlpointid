"use client";

import { useEffect, useMemo, useState } from "react";
import { Calendar, Clock, LogOut, Pencil, Printer, RefreshCcw, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_LABELS,
  TIME_FIELDS,
  analyzeMonth,
  calculateRecordState,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  formatRecordDuration,
  formatSignedDuration,
  monthStartKey,
  todayKey,
  totalMinutes,
} from "@/lib/date";

const emptyDraft = {
  entrada: "",
  saida_almoco: "",
  retorno_almoco: "",
  saida: "",
  observacao: "",
};

export default function PontoClient({ userId, initialProfile }) {
  const supabase = useMemo(() => createClient(), []);
  const today = todayKey();
  const currentMonth = currentMonthKey();
  const [month, setMonth] = useState(currentMonth);
  const [selectedDate, setSelectedDate] = useState(today);
  const [records, setRecords] = useState([]);
  const [draftRecord, setDraftRecord] = useState(emptyDraft);
  const [approval, setApproval] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const recordsByDate = useMemo(() => {
    return Object.fromEntries(records.map((record) => [record.work_date, record]));
  }, [records]);

  const monthDays = daysInMonth(month);
  const monthStart = monthStartKey(month);
  const monthEnd = endOfMonthKey(month);
  const maxSelectableDate = minDateKey(monthEnd, today);
  const selectedDay = monthDays.find((day) => day.key === selectedDate);
  const selectedSavedRecord = recordsByDate[selectedDate];
  const isCorrection = Boolean(selectedSavedRecord) || selectedDate < today;
  const todayRecord = recordsByDate[today] || {};
  const nextPunchKind = month === currentMonth ? getNextPunchKind(todayRecord) : null;
  const canClockPunch = !busy && (month !== currentMonth || Boolean(nextPunchKind));
  const draftState = calculateRecordState(draftRecord);
  const canSaveDay = draftState.valid && draftState.complete && !busy;
  const monthTotal = totalMinutes(records);
  const monthSummary = analyzeMonth(monthDays, recordsByDate, initialProfile, today);

  useEffect(() => {
    loadRecords();
  }, [month]);

  useEffect(() => {
    syncSelectedDraft(recordsByDate[selectedDate]);
  }, [selectedDate, records]);

  async function loadRecords() {
    const [{ data, error }, { data: approvalData, error: approvalError }] = await Promise.all([
      supabase
        .from("time_records")
        .select("*")
        .eq("user_id", userId)
        .gte("work_date", monthStartKey(month))
        .lte("work_date", endOfMonthKey(month))
        .order("work_date", { ascending: true }),
      supabase
        .from("timesheet_approvals")
        .select("*")
        .eq("user_id", userId)
        .eq("month", monthStartKey(month))
        .maybeSingle(),
    ]);

    if (error || approvalError) {
      setMessage(error?.message || approvalError?.message);
      return;
    }

    setRecords(data || []);
    setApproval(approvalData || null);
  }

  function syncSelectedDraft(savedRecord) {
    const storedDraft = readStoredDraft(selectedDate);
    setDraftRecord(storedDraft || draftFromRecord(savedRecord));
  }

  function draftKey(dateKey) {
    return `controlpointid:ponto-draft:${userId}:${dateKey}`;
  }

  function readStoredDraft(dateKey) {
    if (typeof window === "undefined") return null;

    const key = draftKey(dateKey);

    try {
      const rawDraft = window.localStorage.getItem(key);
      if (!rawDraft) return null;
      return normalizeDraft(JSON.parse(rawDraft));
    } catch {
      window.localStorage.removeItem(key);
      return null;
    }
  }

  function persistDraft(dateKey, draft) {
    if (typeof window === "undefined") return;

    const key = draftKey(dateKey);

    if (!hasDraftValue(draft)) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(normalizeDraft(draft)));
  }

  function clearStoredDraft(dateKey) {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(draftKey(dateKey));
  }

  function handleMonthChange(nextMonth) {
    const nextStart = monthStartKey(nextMonth);
    const nextEnd = endOfMonthKey(nextMonth);
    const nextMax = minDateKey(nextEnd, today);
    const preferredDate = nextMonth === currentMonth ? today : nextStart;

    setMonth(nextMonth);
    setSelectedDate(clampDateKey(preferredDate, nextStart, nextMax));
    setMessage("");
  }

  function selectCorrectionDate(dateKey) {
    if (dateKey > today) {
      setMessage("Nao e possivel corrigir data futura.");
      return;
    }

    setMonth(dateKey.slice(0, 7));
    setSelectedDate(dateKey);
    setMessage("");
  }

  function handleSelectedDateChange(value) {
    if (!value) return;

    setSelectedDate(clampDateKey(value, monthStart, maxSelectableDate));
    setMessage("");
  }

  function updateDraft(field, value) {
    const nextDraft = normalizeDraft({ ...draftRecord, [field]: value });
    setDraftRecord(nextDraft);
    persistDraft(selectedDate, nextDraft);
    setMessage("");
  }

  async function clockPunch() {
    setBusy(true);
    setMessage("");

    const { data: liveRecord, error: liveRecordError } = await supabase
      .from("time_records")
      .select("*")
      .eq("user_id", userId)
      .eq("work_date", today)
      .maybeSingle();

    if (liveRecordError) {
      setBusy(false);
      setMessage(liveRecordError.message);
      return;
    }

    if (selectedDate === today && hasDraftValue(draftRecord) && !draftsEqual(draftRecord, liveRecord)) {
      setBusy(false);
      setMessage("Voce tem horarios digitados em hoje. Salve ou atualize antes de bater ponto.");
      return;
    }

    const punchKind = getNextPunchKind(liveRecord || {});

    if (!punchKind) {
      setBusy(false);
      setMessage("Todos os pontos de hoje ja foram registrados.");
      return;
    }

    const { data, error } = await supabase.rpc("clock_time", { p_kind: punchKind });
    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    const recordMonth = data.work_date.slice(0, 7);
    if (recordMonth !== month) {
      setMonth(recordMonth);
    }

    setSelectedDate(data.work_date);
    clearStoredDraft(data.work_date);
    setDraftRecord(draftFromRecord(data));
    setRecords((current) => replaceRecord(current, data));
    setMessage(`${FIELD_LABELS[punchKind]} registrada as ${cleanTime(data[punchKind])}.`);
  }

  async function saveDay(draft = draftRecord, options = {}) {
    const nextDraft = normalizeDraft(draft);
    const state = calculateRecordState(nextDraft);

    if (!state.valid) {
      setMessage("Horarios invalidos. Confira a ordem dos campos.");
      return;
    }

    if (!state.complete) {
      if (!options.silent) {
        setMessage("Preencha a saida final para concluir o dia.");
      }
      return;
    }

    setBusy(true);
    setMessage("");

    const response = await fetch("/api/ponto/day", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        work_date: selectedDate,
        entrada: nextDraft.entrada,
        saida_almoco: nextDraft.saida_almoco,
        retorno_almoco: nextDraft.retorno_almoco,
        saida: nextDraft.saida,
        observacao: nextDraft.observacao,
      }),
    });
    const result = await response.json();

    setBusy(false);

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel salvar o ponto.");
      return;
    }

    const data = result.record;
    clearStoredDraft(selectedDate);
    setDraftRecord(draftFromRecord(data));

    if (data?.work_date?.slice(0, 7) === month) {
      setRecords((current) => replaceRecord(current, data));
    }

    setMessage(`${isCorrection ? "Correcao" : "Dia"} ${formatDateLabel(selectedDate)} salvo no mes.`);
  }

  async function approveMonth() {
    setBusy(true);
    setMessage("");

    const response = await fetch("/api/ponto/approve-month", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month }),
    });
    const result = await response.json();
    setBusy(false);

    if (!response.ok) {
      setMessage(result.error || "Nao foi possivel confirmar a folha.");
      return;
    }

    setApproval(result.approval || null);
    setMessage(`Folha de ${formatMonthLabel(month)} confirmada.`);
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
          <p className="eyebrow">Funcionario</p>
          <h1>Meu ponto</h1>
          <p className="muted">{initialProfile.full_name}</p>
        </div>
        <div className="header-actions">
          <button className="secondary" type="button" onClick={loadRecords} disabled={busy}>
            <RefreshCcw size={18} />
            Atualizar
          </button>
          <button className="secondary" type="button" onClick={printSheet}>
            <Printer size={18} />
            Imprimir
          </button>
          <button className="secondary icon-only" type="button" onClick={signOut} title="Sair">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="toolbar">
        <label>
          Mes
          <input
            type="month"
            value={month}
            max={currentMonth}
            onChange={(event) => handleMonthChange(event.target.value)}
          />
        </label>
        <div className="metric">
          <span>Total do mes</span>
          <strong>{formatDuration(monthTotal)}</strong>
        </div>
      </section>


      <section className="panel summary-panel">
        <div className="panel-heading">
          <div>
            <h2>Resumo do mes</h2>
            <p className="muted">Pendencias, horas extras e saldo da sua jornada.</p>
          </div>
          <button className="primary" type="button" onClick={approveMonth} disabled={busy || records.length === 0}>
            <Save size={18} />
            {approval ? "Confirmar novamente" : "Confirmar folha do mes"}
          </button>
        </div>
        <div className="summary-grid">
          <div className="summary-card"><span>Pendencias</span><strong>{monthSummary.pending}</strong></div>
          <div className="summary-card"><span>Faltas</span><strong>{monthSummary.absences}</strong></div>
          <div className="summary-card"><span>Incompletos</span><strong>{monthSummary.incomplete}</strong></div>
          <div className="summary-card"><span>Horas extras</span><strong>{formatDuration(monthSummary.overtimeMinutes)}</strong></div>
          <div className={`summary-card ${monthSummary.balanceMinutes < 0 ? "danger" : ""}`}><span>Banco de horas</span><strong>{formatSignedDuration(monthSummary.balanceMinutes)}</strong></div>
        </div>
        {approval ? <div className="notice success">Folha confirmada em {new Date(approval.approved_at).toLocaleString("pt-BR")}.</div> : null}
        {monthSummary.issues.length > 0 ? (
          <div className="issue-list">
            {monthSummary.issues.slice(0, 6).map((issue) => (
              <span key={`${issue.type}-${issue.date}`}>{issue.label}: {issue.detail}</span>
            ))}
          </div>
        ) : <div className="notice success">Nenhuma pendencia encontrada na jornada esperada.</div>}
      </section>
      <section className="panel punch-panel">
        <div className="panel-heading">
          <div>
            <h2>{isCorrection ? "Corrigir dia" : "Registrar dia"}</h2>
            <p className="muted">{selectedDay?.label || formatDateLabel(selectedDate)}</p>
          </div>
          <Clock size={24} />
        </div>
        <div className="quick-punch">
          <div>
            <strong>Ponto de hoje</strong>
            <span>{nextPunchKind ? `Proximo: ${FIELD_LABELS[nextPunchKind]}` : month === currentMonth ? "Todos os pontos de hoje foram registrados." : "Registra no dia de hoje."}</span>
          </div>
          <button className="primary" type="button" onClick={clockPunch} disabled={!canClockPunch}>
            <Clock size={18} />
            Bater ponto
          </button>
        </div>
        <div className="date-controls">
          <label>
            Dia
            <input
              type="date"
              value={selectedDate}
              min={monthStart}
              max={maxSelectableDate}
              disabled={busy}
              onChange={(event) => handleSelectedDateChange(event.target.value)}
            />
          </label>
          <button
            className="secondary"
            type="button"
            onClick={() => selectCorrectionDate(today)}
            disabled={busy || selectedDate === today}
          >
            <Calendar size={18} />
            Hoje
          </button>
        </div>
        <div className="punch-form">
          {TIME_FIELDS.map((field) => (
            <label className="punch-field" key={field}>
              <span>{FIELD_LABELS[field]}</span>
              <input
                type="time"
                value={draftRecord[field] || ""}
                disabled={busy}
                onChange={(event) => updateDraft(field, event.target.value)}
                onBlur={(event) => {
                  if (field === "saida") {
                    saveDay({ ...draftRecord, [field]: event.currentTarget.value }, { silent: true });
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                }}
              />
            </label>
          ))}
          <label className="punch-field punch-note">
            <span>Observacao</span>
            <input
              value={draftRecord.observacao || ""}
              disabled={busy}
              onChange={(event) => updateDraft("observacao", event.target.value)}
            />
          </label>
        </div>
        <div className="day-actions">
          <div className="metric">
            <span>Total do dia</span>
            <strong>{formatRecordDuration(draftRecord)}</strong>
          </div>
          <button className="primary" type="button" onClick={() => saveDay()} disabled={!canSaveDay}>
            <Save size={18} />
            {busy ? "Salvando..." : isCorrection ? "Salvar correcao" : "Concluir dia"}
          </button>
        </div>
        {message ? <div className="notice">{message}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>Registros do mes</h2>
          <span className="muted">{formatMonthLabel(month)}</span>
        </div>
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
                <th>Acao</th>
              </tr>
            </thead>
            <tbody>
              {monthDays.map((day) => {
                const record = recordsByDate[day.key] || {};
                const isFutureDay = day.key > today;
                const isSelected = day.key === selectedDate;

                return (
                  <tr
                    key={day.key}
                    className={`${day.isWeekend ? "weekend" : ""} ${isSelected ? "selected-day" : ""}`}
                  >
                    <td>{day.weekday}</td>
                    <td>{day.label}</td>
                    {TIME_FIELDS.map((field) => (
                      <td key={field}>{cleanTime(record[field]) || "--:--"}</td>
                    ))}
                    <td className="strong">{formatRecordDuration(record)}</td>
                    <td>{record.observacao || ""}</td>
                    <td className="correction-cell">
                      <button
                        className={isSelected ? "primary" : "secondary"}
                        type="button"
                        onClick={() => selectCorrectionDate(day.key)}
                        disabled={busy || isFutureDay}
                      >
                        <Pencil size={16} />
                        Corrigir
                      </button>
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
        profile={initialProfile}
        days={monthDays}
        recordsByDate={recordsByDate}
        monthTotal={monthTotal}
      />
    </main>
  );
}

function getNextPunchKind(record) {
  return TIME_FIELDS.find((field) => !cleanTime(record?.[field])) || null;
}

function draftsEqual(first, second) {
  const firstDraft = normalizeDraft(first);
  const secondDraft = normalizeDraft(second || emptyDraft);

  return (
    TIME_FIELDS.every((field) => firstDraft[field] === secondDraft[field]) &&
    firstDraft.observacao === secondDraft.observacao
  );
}

function normalizeDraft(draft) {
  return {
    entrada: cleanTime(draft?.entrada),
    saida_almoco: cleanTime(draft?.saida_almoco),
    retorno_almoco: cleanTime(draft?.retorno_almoco),
    saida: cleanTime(draft?.saida),
    observacao: draft?.observacao || "",
  };
}

function draftFromRecord(record) {
  return normalizeDraft(record || emptyDraft);
}

function hasDraftValue(draft) {
  return TIME_FIELDS.some((field) => Boolean(draft?.[field])) || Boolean(draft?.observacao);
}

function replaceRecord(current, data) {
  const withoutRecord = current.filter((record) => record.work_date !== data.work_date);
  return [...withoutRecord, data].sort((a, b) => a.work_date.localeCompare(b.work_date));
}

function minDateKey(firstDate, secondDate) {
  return firstDate <= secondDate ? firstDate : secondDate;
}

function clampDateKey(dateKey, minDate, maxDate) {
  if (maxDate < minDate) return minDate;
  if (dateKey < minDate) return minDate;
  if (dateKey > maxDate) return maxDate;
  return dateKey;
}

function formatDateLabel(dateKey) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function PrintSheet({ month, profile, days, recordsByDate, monthTotal }) {
  return (
    <section className="print-sheet">
      <header className="print-header">
        <div>
          <h1>Folha de Ponto</h1>
          <p>{formatMonthLabel(month)}</p>
        </div>
        <div>
          <p>
            <strong>Funcionario:</strong> {profile.full_name}
          </p>
          <p>
            <strong>Cargo:</strong> {profile.job_title || ""}
          </p>
        </div>
      </header>
      <PrintTable days={days} recordsByDate={recordsByDate} monthTotal={monthTotal} />
    </section>
  );
}

function PrintTable({ days, recordsByDate, monthTotal }) {
  return (
    <>
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
    </>
  );
}
