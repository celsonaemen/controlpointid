export const FIELD_LABELS = {
  entrada: "Entrada",
  saida_almoco: "Saida almoco",
  retorno_almoco: "Retorno almoco",
  saida: "Saida",
};

export const TIME_FIELDS = ["entrada", "saida_almoco", "retorno_almoco", "saida"];

export const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

export function currentMonthKey() {
  return monthKeyFromDate(new Date());
}

export function todayKey() {
  return dateKeyFromDate(new Date());
}

export function monthKeyFromDate(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1)].join("-");
}

export function dateKeyFromDate(date) {
  return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
}

export function endOfMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  return dateKeyFromDate(new Date(year, month, 0));
}

export function monthStartKey(monthKey) {
  return `${monthKey}-01`;
}

export function daysInMonth(monthKey) {
  const [year, monthNumber] = monthKey.split("-").map(Number);
  const month = monthNumber - 1;
  const date = new Date(year, month, 1);
  const days = [];

  while (date.getMonth() === month) {
    const item = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    days.push({
      date: item,
      key: dateKeyFromDate(item),
      weekday: WEEKDAYS[item.getDay()],
      isWeekend: item.getDay() === 0 || item.getDay() === 6,
      label: `${pad(item.getDate())}/${pad(item.getMonth() + 1)}/${item.getFullYear()}`,
    });
    date.setDate(date.getDate() + 1);
  }

  return days;
}

export function calculateRecordState(record) {
  const hasEntrada = Boolean(record?.entrada);
  const hasSaidaAlmoco = Boolean(record?.saida_almoco);
  const hasRetornoAlmoco = Boolean(record?.retorno_almoco);
  const hasSaida = Boolean(record?.saida);
  const hasAnyTime = hasEntrada || hasSaidaAlmoco || hasRetornoAlmoco || hasSaida;

  if (!hasAnyTime) {
    return { valid: true, complete: false, minutes: 0 };
  }

  const entrada = timeToMinutes(record?.entrada);
  const saidaAlmoco = timeToMinutes(record?.saida_almoco);
  const retornoAlmoco = timeToMinutes(record?.retorno_almoco);
  const saida = timeToMinutes(record?.saida);

  if (
    invalidTime(record?.entrada, entrada) ||
    invalidTime(record?.saida_almoco, saidaAlmoco) ||
    invalidTime(record?.retorno_almoco, retornoAlmoco) ||
    invalidTime(record?.saida, saida)
  ) {
    return invalidRecord();
  }

  if (!hasEntrada) {
    return invalidRecord();
  }

  if (hasRetornoAlmoco && !hasSaidaAlmoco) {
    return invalidRecord();
  }

  if (hasSaida && hasSaidaAlmoco && !hasRetornoAlmoco) {
    return invalidRecord();
  }

  if (saidaAlmoco !== null && saidaAlmoco < entrada) {
    return invalidRecord();
  }

  if (retornoAlmoco !== null && retornoAlmoco < saidaAlmoco) {
    return invalidRecord();
  }

  if (saida !== null) {
    if (saida < entrada) {
      return invalidRecord();
    }

    if (retornoAlmoco !== null && saida < retornoAlmoco) {
      return invalidRecord();
    }

    if (saidaAlmoco !== null && retornoAlmoco === null) {
      return invalidRecord();
    }
  }

  if (saida === null) {
    return { valid: true, complete: false, minutes: 0 };
  }

  let minutes = saida - entrada;

  if (saidaAlmoco !== null && retornoAlmoco !== null) {
    minutes -= retornoAlmoco - saidaAlmoco;
  }

  if (minutes < 0 || minutes > 1440) {
    return invalidRecord();
  }

  return { valid: true, complete: true, minutes };
}

export function calculateRecordMinutes(record) {
  const state = calculateRecordState(record);
  return state.valid && state.complete ? state.minutes : 0;
}

export function formatRecordDuration(record) {
  const state = calculateRecordState(record);

  if (!state.valid) return "Invalido";
  if (!state.complete) return "--:--";
  return formatDuration(state.minutes);
}

export function totalMinutes(records) {
  return records.reduce((sum, record) => sum + calculateRecordMinutes(record), 0);
}

export function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${pad(hours)}:${pad(rest)}`;
}

export function cleanTime(value) {
  if (!value) return "";
  return String(value).slice(0, 5);
}

export function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const formatter = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  });
  return formatter.format(new Date(year, month - 1, 1));
}

export const DEFAULT_WORKDAYS = [1, 2, 3, 4, 5];
export const DEFAULT_EXPECTED_DAILY_MINUTES = 480;
export const DEFAULT_EXPECTED_START_TIME = "08:00";
export const DEFAULT_EXPECTED_END_TIME = "17:00";

export function profileWorkdays(profile) {
  const rawWorkdays = Array.isArray(profile?.workdays) ? profile.workdays : DEFAULT_WORKDAYS;
  const uniqueWorkdays = [...new Set(rawWorkdays.map(Number))]
    .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    .sort((a, b) => a - b);

  return uniqueWorkdays.length > 0 ? uniqueWorkdays : DEFAULT_WORKDAYS;
}

export function profileExpectedDailyMinutes(profile) {
  const minutes = Number(profile?.expected_daily_minutes);
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 1440) {
    return DEFAULT_EXPECTED_DAILY_MINUTES;
  }

  return Math.round(minutes);
}

export function profileExpectedStartTime(profile) {
  return cleanTime(profile?.expected_start_time) || DEFAULT_EXPECTED_START_TIME;
}

export function profileExpectedEndTime(profile) {
  return cleanTime(profile?.expected_end_time) || DEFAULT_EXPECTED_END_TIME;
}

export function formatSignedDuration(minutes) {
  const sign = minutes < 0 ? "-" : minutes > 0 ? "+" : "";
  return `${sign}${formatDuration(Math.abs(minutes))}`;
}

export function analyzeMonth(days, recordsByDate, profile, today = todayKey()) {
  const workdays = profileWorkdays(profile);
  const expectedDailyMinutes = profileExpectedDailyMinutes(profile);
  const expectedStart = timeToMinutes(profileExpectedStartTime(profile));
  const expectedEnd = timeToMinutes(profileExpectedEndTime(profile));
  const monthKey = days[0]?.key?.slice(0, 7) || currentMonthKey();
  const currentMonth = today.slice(0, 7);
  const cutoffDate = monthKey === currentMonth ? today : monthKey < currentMonth ? endOfMonthKey(monthKey) : "0000-00-00";
  const summary = {
    expectedMinutes: 0,
    workedMinutes: 0,
    balanceMinutes: 0,
    overtimeMinutes: 0,
    missingMinutes: 0,
    absences: 0,
    incomplete: 0,
    invalid: 0,
    late: 0,
    earlyLeave: 0,
    pending: 0,
    issues: [],
  };

  for (const day of days) {
    if (day.key > cutoffDate) continue;
    if (!workdays.includes(day.date.getDay())) continue;

    const record = recordsByDate?.[day.key] || {};
    const hasAnyTime = TIME_FIELDS.some((field) => Boolean(cleanTime(record[field])));
    const state = calculateRecordState(record);
    summary.expectedMinutes += expectedDailyMinutes;

    if (!hasAnyTime) {
      summary.absences += 1;
      summary.missingMinutes += expectedDailyMinutes;
      summary.issues.push({ type: "absence", date: day.key, label: day.label, detail: "Sem ponto registrado." });
      continue;
    }

    if (!state.valid) {
      summary.invalid += 1;
      summary.missingMinutes += expectedDailyMinutes;
      summary.issues.push({ type: "invalid", date: day.key, label: day.label, detail: "Horarios invalidos." });
      continue;
    }

    if (!state.complete) {
      summary.incomplete += 1;
      summary.missingMinutes += expectedDailyMinutes;
      summary.issues.push({ type: "incomplete", date: day.key, label: day.label, detail: "Ponto incompleto." });
      continue;
    }

    summary.workedMinutes += state.minutes;

    const entrada = timeToMinutes(record.entrada);
    const saida = timeToMinutes(record.saida);

    if (expectedStart !== null && entrada !== null && entrada > expectedStart) {
      summary.late += 1;
      summary.issues.push({ type: "late", date: day.key, label: day.label, detail: `Entrada apos ${profileExpectedStartTime(profile)}.` });
    }

    if (expectedEnd !== null && saida !== null && saida < expectedEnd) {
      summary.earlyLeave += 1;
      summary.issues.push({ type: "early", date: day.key, label: day.label, detail: `Saida antes de ${profileExpectedEndTime(profile)}.` });
    }

    if (state.minutes > expectedDailyMinutes) {
      summary.overtimeMinutes += state.minutes - expectedDailyMinutes;
    } else if (state.minutes < expectedDailyMinutes) {
      summary.missingMinutes += expectedDailyMinutes - state.minutes;
    }
  }

  summary.balanceMinutes = summary.workedMinutes - summary.expectedMinutes;
  summary.pending = summary.absences + summary.incomplete + summary.invalid;
  return summary;
}
function invalidRecord() {
  return { valid: false, complete: false, minutes: 0 };
}

function invalidTime(rawValue, minutes) {
  return Boolean(rawValue) && minutes === null;
}

function timeToMinutes(value) {
  if (!value) return null;
  const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);

  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
}

function pad(value) {
  return String(value).padStart(2, "0");
}