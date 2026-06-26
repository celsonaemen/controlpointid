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
  const entrada = timeToMinutes(record?.entrada);
  const saidaAlmoco = timeToMinutes(record?.saida_almoco);
  const retornoAlmoco = timeToMinutes(record?.retorno_almoco);
  const saida = timeToMinutes(record?.saida);
  const hasLunchStart = Boolean(record?.saida_almoco);
  const hasLunchEnd = Boolean(record?.retorno_almoco);

  if (!record || (!record.entrada && !record.saida_almoco && !record.retorno_almoco && !record.saida)) {
    return { valid: true, complete: false, minutes: 0 };
  }

  if (invalidTime(record.entrada, entrada) || invalidTime(record.saida_almoco, saidaAlmoco) || invalidTime(record.retorno_almoco, retornoAlmoco) || invalidTime(record.saida, saida)) {
    return { valid: false, complete: false, minutes: 0 };
  }

  if (hasLunchStart !== hasLunchEnd) {
    return { valid: false, complete: false, minutes: 0 };
  }

  if (entrada === null || saida === null) {
    return { valid: true, complete: false, minutes: 0 };
  }

  if (saida < entrada) {
    return { valid: false, complete: false, minutes: 0 };
  }

  let minutes = saida - entrada;

  if (saidaAlmoco !== null && retornoAlmoco !== null) {
    const lunchOutsideWorkday = saidaAlmoco < entrada || retornoAlmoco > saida;
    const lunchInverted = retornoAlmoco < saidaAlmoco;

    if (lunchOutsideWorkday || lunchInverted) {
      return { valid: false, complete: false, minutes: 0 };
    }

    minutes -= retornoAlmoco - saidaAlmoco;
  }

  if (minutes < 0 || minutes > 1440) {
    return { valid: false, complete: false, minutes: 0 };
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