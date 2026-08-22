// Cadence math for recurring ops. All dates are plain "YYYY-MM-DD" strings,
// handled as UTC midnight internally so day math never drifts across timezones.

export type CadenceType = "daily" | "weekly" | "monthly" | "every_n_days" | "custom_weekdays";

export interface CadenceConfig {
  interval?: number;
  weekdays?: number[];
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parseDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function addMonthsClamped(d: Date, n: number): Date {
  const day = d.getUTCDate();
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const daysInMonth = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, daysInMonth));
  return r;
}

export function todayStr(): string {
  return formatDate(new Date());
}

/** Next occurrence strictly after `anchorStr`, per the cadence rule. */
export function nextDueDate(type: CadenceType, config: CadenceConfig, anchorStr: string): string {
  const anchor = parseDate(anchorStr);
  switch (type) {
    case "daily":
      return formatDate(addDays(anchor, 1));
    case "weekly":
      return formatDate(addDays(anchor, 7));
    case "monthly":
      return formatDate(addMonthsClamped(anchor, 1));
    case "every_n_days": {
      const interval = Math.max(1, config.interval ?? 1);
      return formatDate(addDays(anchor, interval));
    }
    case "custom_weekdays": {
      const weekdays = config.weekdays ?? [];
      if (weekdays.length === 0) return formatDate(addDays(anchor, 1));
      for (let i = 1; i <= 14; i++) {
        const cand = addDays(anchor, i);
        if (weekdays.includes(cand.getUTCDay())) return formatDate(cand);
      }
      return formatDate(addDays(anchor, 7));
    }
    default:
      throw new Error(`Unknown cadence type: ${type}`);
  }
}

/** First due date for a newly claimed op, anchored off "today" (inclusive). */
export function firstDueDate(type: CadenceType, config: CadenceConfig, today = todayStr()): string {
  if (type === "custom_weekdays") {
    const weekdays = config.weekdays ?? [];
    const t = parseDate(today);
    if (weekdays.includes(t.getUTCDay())) return today;
    for (let i = 1; i <= 14; i++) {
      const cand = addDays(t, i);
      if (weekdays.includes(cand.getUTCDay())) return formatDate(cand);
    }
  }
  return today;
}

export function describeCadence(type: CadenceType, config: CadenceConfig): string {
  switch (type) {
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "monthly":
      return "Monthly";
    case "every_n_days": {
      const n = config.interval ?? 1;
      return `Every ${n} day${n === 1 ? "" : "s"}`;
    }
    case "custom_weekdays": {
      const days = (config.weekdays ?? []).slice().sort((a, b) => a - b).map((d) => WEEKDAY_NAMES[d]);
      return days.length ? `Every ${days.join("/")}` : "Custom";
    }
    default:
      return type;
  }
}
