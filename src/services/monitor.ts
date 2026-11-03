/**
 * Сторож (scripts/watchdog.ts): что считать поломкой и что об этом написать в чат.
 * Здесь только чистые функции — сеть, диск и Telegram живут в скрипте, поэтому логику видно в тесте.
 */

export const KINDS = ["bot", "telegram", "tunnel"] as const;
export type Kind = (typeof KINDS)[number];
export type Check = { ok: boolean; detail: string };
export type Checks = Record<Kind, Check>;
export type MonitorState = {
  /** Что увидел последний запуск. */
  checks: Checks;
  /** Когда начался текущий простой, ISO. Нет ключа — простоев нет. */
  downSince: Partial<Record<Kind, string>>;
  /** Сколько провалов подряд: о поломке говорим со второго, иначе перезапуск бота (гаснет Mini App) спамит чат. */
  failing: Partial<Record<Kind, number>>;
  /** О простое этого вида уже написали — второй раз не пишем. */
  notified: Partial<Record<Kind, boolean>>;
  lastRun: string;
  /** Когда о текущем простое последний раз писали: по нему решается, пора ли напомнить. */
  lastNotice?: string;
  /** Когда сторож последний раз перезапускал бота: защита от карусели перезапусков. */
  lastRestart?: string;
};
export type Transition = { state: MonitorState; broke: Kind[]; fixed: Kind[]; slept: boolean };

/** Дольше этого между запусками — значит мак спал или был выключен: простой не наш, не считаем. */
export const SLEEP_GAP_MS = 5 * 60_000;
/** Провалов подряд до сообщения. Перезапуск бота гасит Mini App на секунды — это не поломка. */
export const CONFIRM_FAILURES = 2;
/** Не перезапускать бота чаще раза в 10 минут: иначе падающий сразу после старта бот зациклится. */
export const RESTART_PAUSE_MS = 10 * 60_000;

const NAMES: Record<Kind, { full: string; short: string }> = {
  bot: { full: "🤖 Бот", short: "бот" },
  telegram: { full: "📡 Telegram", short: "Telegram" },
  tunnel: { full: "🌐 Туннель (ngrok / Mini App)", short: "туннель" },
};

/** Подсказки по тексту ошибки: чаще всего дело не в самом боте, и это стоит сказать сразу. */
const HINTS: { re: RegExp; hint: string }[] = [
  // ERR_NGROK_9040 — ngrok не пускает по адресу агента. Это не «VPN сломался», а ограничение самого ngrok:
  // бесплатный аккаунт не подключается с российских адресов. Выключение VPN ситуацию не улучшит.
  { re: /ERR_NGROK_9040|IP address/i, hint: "ngrok не пускает агента с этого IP — ограничение ngrok, а не бота: бесплатный аккаунт не работает из России. Нужен другой туннель или платный аккаунт." },
  { re: /ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|ETIMEDOUT|TimeoutError/i, hint: "нет сети или DNS — проверь VPN и Wi-Fi." },
];

const allOk = (): Checks => ({ bot: { ok: true, detail: "—" }, telegram: { ok: true, detail: "—" }, tunnel: { ok: true, detail: "—" } });

export const downKinds = (checks: Checks): Kind[] => KINDS.filter((k) => !checks[k].ok);

/**
 * Сравнивает прошлое состояние с текущим: что сломалось, что починилось.
 * После сна состояние сбрасывается на «всё было хорошо»: иначе утром пришло бы «лежало 7 часов».
 */
export function nextState(prev: MonitorState | undefined, checks: Checks, now: Date): Transition {
  const slept = prev !== undefined && now.getTime() - Date.parse(prev.lastRun) > SLEEP_GAP_MS;
  const was = prev && !slept ? prev : undefined;
  const downSince = { ...was?.downSince };
  const failing = { ...was?.failing };
  const notified = { ...was?.notified };

  for (const k of KINDS) {
    if (checks[k].ok) {
      // Вернулось: и счётчик провалов, и начало простоя больше не нужны — даже если о поломке не сообщали.
      delete failing[k];
      delete downSince[k];
      continue;
    }
    failing[k] = (failing[k] ?? 0) + 1;
    // Начало простоя — первый провал, а не подтверждение: иначе в отчёте терялась бы минута.
    downSince[k] ??= now.toISOString();
  }

  const broke = KINDS.filter((k) => !checks[k].ok && (failing[k] ?? 0) >= CONFIRM_FAILURES && !notified[k]);
  const fixed = KINDS.filter((k) => checks[k].ok && notified[k]);
  for (const k of fixed) delete notified[k];

  return { state: { checks, downSince, failing, notified, lastRun: now.toISOString() }, broke, fixed, slept };
}

/**
 * Отметить, что о поломке действительно сообщили. Вызывается только после успешной отправки:
 * если Telegram в этот момент недоступен, тревога остаётся неподтверждённой и повторится на следующем запуске.
 * Иначе «отвалился бот, а вместе с ним и сеть» — ровно тот случай, когда сообщение нужнее всего, — терялось бы навсегда.
 */
export function markNotified(state: MonitorState, kinds: Kind[]): void {
  for (const k of kinds) state.notified[k] = true;
}

/**
 * Пора ли перезапускать бота. Он лежит и сам не встанет: launchd видит живой процесс и не вмешивается.
 * Пауза нужна, чтобы бот, падающий сразу после старта, не попал в карусель перезапусков.
 */
export function shouldRestartBot(checks: Checks, state: MonitorState, now: Date): boolean {
  if (checks.bot.ok) return false;
  if (!state.lastRestart) return true;
  const last = Date.parse(state.lastRestart);
  // Битое время в state — считаем, что перезапусков не было: лучше попробовать, чем молча ждать.
  return !Number.isFinite(last) || now.getTime() - last > RESTART_PAUSE_MS;
}

export function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "меньше минуты";
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

/** 02.11, 17:20 — короче и понятнее, чем ISO. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}, ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const hintFor = (detail: string) => HINTS.find((h) => h.re.test(detail))?.hint;

export function problemText(broke: Kind[], checks: Checks, now: Date): string {
  const rest = KINDS.filter((k) => !broke.includes(k) && checks[k].ok);
  return [
    `🔴 Отвалилось (${formatTime(now.toISOString())})`,
    ...broke.map((k) => {
      const hint = hintFor(checks[k].detail);
      return `• ${NAMES[k].full} — ${checks[k].detail}${hint ? `\n  ${hint}` : ""}`;
    }),
    rest.length ? `Работает: ${rest.map((k) => NAMES[k].short).join(", ")}.` : "Не работает ничего — похоже, нет интернета.",
  ].join("\n");
}

export function recoveryText(fixed: Kind[], downSince: MonitorState["downSince"], checks: Checks, now: Date): string {
  const was = (k: Kind) => {
    const since = downSince[k];
    return since ? `простой ${formatDuration(now.getTime() - Date.parse(since))}, с ${formatTime(since)}` : "снова отвечает";
  };
  return [
    `🟢 Снова работает (${formatTime(now.toISOString())})`,
    ...fixed.map((k) => `• ${NAMES[k].full} — ${was(k)}`),
    `Сейчас: ${KINDS.map((k) => `${NAMES[k].short} ${checks[k].ok ? "✅" : "❌"}`).join(", ")}`,
  ].join("\n");
}

/** Для `--status`: что сейчас и что лежит с какого времени. */
export function statusText(checks: Checks, state: MonitorState | undefined): string {
  const down = downKinds(checks);
  return [
    ...KINDS.map((k) => `${checks[k].ok ? "✅" : "❌"} ${NAMES[k].full} — ${checks[k].detail}`),
    // «Лежит с» — только про то, что лежит сейчас: остатки в state от прошлой поломки путают.
    down.length
      ? `Лежит с: ${down.map((k) => `${NAMES[k].short} ${formatTime(state?.downSince[k] ?? new Date().toISOString())}`).join(", ")}`
      : "Поломок нет.",
  ].join("\n");
}
