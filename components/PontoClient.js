"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, LogOut, Printer, RefreshCcw, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_LABELS,
  TIME_FIELDS,
  calculateRecordState,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  formatRecordDuration,
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
  const [month, setMonth] = useState(currentMonthKey());
  const [records, setRecords] = useState([]);
  const [draftToday, setDraftToday] = useState(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const today = todayKey();
  const todayDraftKey = `controlpointid:ponto-draft:${userId}:${today}`;

  const recordsByDate = useMemo(() => {
    return Object.fromEntries(records.map((record) => [record.work_date, record]));
  }, [records]);

  const monthDays = daysInMonth(month);
  const monthTotal = totalMinutes(records);
  const draftState = calculateRecordState(draftToday);
  const canSaveToday = draftState.valid && draftState.complete && !busy;

  useEffect(() => {
    loadRecords();
  }, [month]);

  async function loadRecords() {
    const { data, error } = await supabase
      .from("time_records")
      .select("*")
      .eq("user_id", userId)
      .gte("work_date", monthStartKey(month))
      .lte("work_date", endOfMonthKey(month))
      .order("work_date", { ascending: true });

    if (error) {
      setMessage(error.message);
      return;
    }

    const loadedRecords = data || [];
    setRecords(loadedRecords);

    let savedToday = loadedRecords.find((record) => record.work_date === today);

    if (!savedToday && month !== currentMonthKey()) {
      const { data: todayData, error: todayError } = await supabase
        .from("time_records")
        .select("*")
        .eq("user_id", userId)
        .eq("work_date", today)
        .maybeSingle();

      if (todayError) {
        setMessage(todayError.message);
        return;
      }

      savedToday = todayData;
    }

    syncTodayDraft(savedToday);
  }

  function syncTodayDraft(savedRecord) {
    const storedDraft = readStoredDraft();
    setDraftToday(storedDraft || draftFromRecord(savedRecord));
  }

  function readStoredDraft() {
    if (typeof window === "undefined") return null;

    try {
      const rawDraft = window.localStorage.getItem(todayDraftKey);
      if (!rawDraft) return null;
      return normalizeDraft(JSON.parse(rawDraft));
    } catch {
      window.localStorage.removeItem(todayDraftKey);
      return null;
    }
  }

  function persistDraft(draft) {
    if (typeof window === "undefined") return;

    if (!hasDraftValue(draft)) {
      window.localStorage.removeItem(todayDraftKey);
      return;
    }

    window.localStorage.setItem(todayDraftKey, JSON.stringify(normalizeDraft(draft)));
  }

  function clearStoredDraft() {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(todayDraftKey);
  }

  function updateDraft(field, value) {
    const nextDraft = normalizeDraft({ ...draftToday, [field]: value });
    setDraftToday(nextDraft);
    persistDraft(nextDraft);
    setMessage("");
  }

  async function saveToday(draft = draftToday, options = {}) {
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

    const { data, error } = await supabase.rpc("save_day_record", {
      p_work_date: today,
      p_entrada: nextDraft.entrada || null,
      p_saida_almoco: nextDraft.saida_almoco || null,
      p_retorno_almoco: nextDraft.retorno_almoco || null,
      p_saida: nextDraft.saida || null,
      p_observacao: nextDraft.observacao || "",
    });

    setBusy(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    clearStoredDraft();
    setDraftToday(draftFromRecord(data));

    if (data?.work_date?.slice(0, 7) === month) {
      setRecords((current) => replaceRecord(current, data));
    }

    setMessage("Dia concluido e salvo no mes.");
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
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <div className="metric">
          <span>Total do mes</span>
          <strong>{formatDuration(monthTotal)}</strong>
        </div>
      </section>

      <section className="panel punch-panel">
        <div className="panel-heading">
          <div>
            <h2>Registrar hoje</h2>
            <p className="muted">{new Date().toLocaleDateString("pt-BR")}</p>
          </div>
          <Clock size={24} />
        </div>
        <div className="punch-form">
          {TIME_FIELDS.map((field) => (
            <label className="punch-field" key={field}>
              <span>{FIELD_LABELS[field]}</span>
              <input
                type="time"
                value={draftToday[field] || ""}
                disabled={busy}
                onChange={(event) => updateDraft(field, event.target.value)}
                onBlur={(event) => {
                  if (field === "saida") {
                    saveToday({ ...draftToday, [field]: event.currentTarget.value }, { silent: true });
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
              value={draftToday.observacao || ""}
              disabled={busy}
              onChange={(event) => updateDraft("observacao", event.target.value)}
            />
          </label>
        </div>
        <div className="day-actions">
          <div className="metric">
            <span>Total do dia</span>
            <strong>{formatRecordDuration(draftToday)}</strong>
          </div>
          <button className="primary" type="button" onClick={() => saveToday()} disabled={!canSaveToday}>
            <Save size={18} />
            {busy ? "Salvando..." : "Concluir dia"}
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
              </tr>
            </thead>
            <tbody>
              {monthDays.map((day) => {
                const record = recordsByDate[day.key] || {};
                return (
                  <tr key={day.key} className={day.isWeekend ? "weekend" : ""}>
                    <td>{day.weekday}</td>
                    <td>{day.label}</td>
                    {TIME_FIELDS.map((field) => (
                      <td key={field}>{cleanTime(record[field]) || "--:--"}</td>
                    ))}
                    <td className="strong">{formatRecordDuration(record)}</td>
                    <td>{record.observacao || ""}</td>
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
