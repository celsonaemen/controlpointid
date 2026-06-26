"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock, LogOut, Printer, RefreshCcw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  FIELD_LABELS,
  TIME_FIELDS,
  calculateRecordMinutes,
  cleanTime,
  currentMonthKey,
  daysInMonth,
  endOfMonthKey,
  formatDuration,
  formatMonthLabel,
  monthStartKey,
  todayKey,
  totalMinutes,
} from "@/lib/date";

export default function PontoClient({ userId, initialProfile }) {
  const supabase = useMemo(() => createClient(), []);
  const [month, setMonth] = useState(currentMonthKey());
  const [records, setRecords] = useState([]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const today = todayKey();

  const recordsByDate = useMemo(() => {
    return Object.fromEntries(records.map((record) => [record.work_date, record]));
  }, [records]);

  const todayRecord = recordsByDate[today] || {};
  const monthDays = daysInMonth(month);
  const monthTotal = totalMinutes(records);

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

    setRecords(data || []);
  }

  async function register(kind) {
    setBusy(kind);
    setMessage("");

    const { error } = await supabase.rpc("clock_time", {
      p_kind: kind,
    });

    setBusy("");

    if (error) {
      setMessage(error.message);
      return;
    }

    setMessage("Ponto registrado.");
    await loadRecords();
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
          <button className="secondary" type="button" onClick={loadRecords}>
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
        <div className="punch-grid">
          {TIME_FIELDS.map((field) => {
            const registered = Boolean(todayRecord[field]);
            return (
              <button
                className={registered ? "secondary" : "primary"}
                type="button"
                key={field}
                onClick={() => register(field)}
                disabled={registered || Boolean(busy)}
              >
                {busy === field ? "Registrando..." : FIELD_LABELS[field]}
                <span>{registered ? cleanTime(todayRecord[field]) : "--:--"}</span>
              </button>
            );
          })}
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
                    <td className="strong">{formatDuration(calculateRecordMinutes(record))}</td>
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
                <td>{formatDuration(calculateRecordMinutes(record))}</td>
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
