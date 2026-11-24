/**
 * Готовые форматтеры по поясу.
 *
 * `Intl.DateTimeFormat` — дорогой конструктор, а локальные даты считаются построчно: напоминания
 * обходят всех людей на каждом тике, статистика и дайджест — каждую запись. Замер на копии
 * прод-базы: 400 строк → 32.7 мс с новым форматтером на каждую против 1.3 мс с готовым, то есть
 * **×15–24** (E32).
 *
 * Кеш на процесс: поясов в проекте единицы (по одному на комнату и на человека), поэтому карта не
 * растёт. Ключ — сам пояс: форматтер зависит только от него, а не от момента.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatters.set(timeZone, made);
  return made;
}

export function localPartsFormatter(timeZone: string): (now: Date) => { date: string; time: string } {
  const formatter = formatterFor(timeZone);
  return (now) => {
    const p = Object.fromEntries(formatter.formatToParts(now).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
  };
}

export function localParts(timeZone: string, now: Date): { date: string; time: string } {
  const formatter = formatterFor(timeZone);
  const p = Object.fromEntries(formatter.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/**
 * Смещение пояса в минутах от UTC для конкретного момента — со сменой летнего времени.
 *
 * Считается через Intl (единственный способ без зависимостей), а не константой вида «+07:00»:
 * Москва и Новосибирск смещение не меняют, но `Europe/London` и `America/New_York` меняют, и
 * зашитое смещение дало бы сдвиг на час полгода.
 */
export function offsetMinutes(timeZone: string, at: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(at)
    .find((part) => part.type === "timeZoneName")?.value;
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name ?? "");
  if (!m) return 0;
  const minutes = Number(m[2]) * 60 + Number(m[3]);
  return m[1] === "-" ? -minutes : minutes;
}

/**
 * Момент UTC, когда в поясе `timeZone` наступает локальное «date time» (например, «2026-11-22 20:00»).
 *
 * Смещение берётся на сам целевой момент, а не на «сейчас»: около перехода на летнее время это разные
 * вещи. Первая догадка может попасть в другой интервал, поэтому смещение уточняется второй раз.
 * Несуществующее локальное время (щель перехода) сдвигается вперёд — на час, а не теряется.
 */
export function localMoment(timeZone: string, date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const guess = new Date(naive - offsetMinutes(timeZone, new Date(naive)) * 60_000);
  const corrected = new Date(naive - offsetMinutes(timeZone, guess) * 60_000);
  return corrected;
}

/**
 * Проверка, что строка — известный IANA-пояс (`Europe/Moscow`), а не мусор и не смещение.
 *
 * Смещение вида «+07:00» современный `Intl` принимает за валидный пояс, но нам оно не годится: у смещения
 * нет перехода на летнее время, и неделя в Лондоне полгода считалась бы неверно. Поэтому требуем, чтобы
 * пояс был непустым, без знака смещения — и разрешался в каноническое имя.
 */
export function isTimeZone(value: string): boolean {
  if (!value || value.startsWith("+") || value.startsWith("-")) return false;
  try {
    // Каноническое имя из `Intl` подтверждает, что пояс известен движку (а не только синтаксически похож).
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone.length > 0;
  } catch {
    return false;
  }
}

export function parseHHMM(input: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${m[2]}`;
}

export function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function nextDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
