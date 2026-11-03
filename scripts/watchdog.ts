/**
 * Сторож: пишет в чат, когда бот, Telegram или туннель отвалились и когда вернулись.
 *   npx tsx scripts/watchdog.ts            — одна проверка (её и запускает launchd раз в минуту)
 *   npx tsx scripts/watchdog.ts --status   — показать сейчас, ничего не отправляя и не запоминая
 *
 * Почему отдельный процесс: бот не может рассказать, что его убили или что VPN съел сеть.
 * Сторож живёт сам по себе, помнит состояние в data/watchdog.json, историю пишет в data/logs/watchdog.log.
 *
 * Настройка в .env: MONITOR_CHAT_ID (группа), MONITOR_ADMIN_ID (личка, необязательно),
 * MONITOR_URL (публичный адрес для проверки туннеля). Ничего не задано — чат молчит, лог всё равно пишется.
 */
import { loadConfig } from "../src/config";
import { downKinds, formatTime, markNotified, nextState, problemText, recoveryText, shouldRestartBot, statusText, type Checks, type MonitorState } from "../src/services/monitor";
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HEARTBEAT_FILE } from "../src/heartbeat";
import { dirname } from "node:path";

try {
  process.loadEnvFile(".env");
} catch {
  // как в index.ts: переменные можно передать окружением
}

const config = loadConfig();
const STATE_FILE = "data/watchdog.json";
const LOG_FILE = "data/logs/watchdog.log";
const CHAT = Number(process.env.MONITOR_CHAT_ID ?? 0);
const ADMIN = Number(process.env.MONITOR_ADMIN_ID ?? config.adminTelegramId ?? 0);
const URL = process.env.MONITOR_URL ?? config.appUrl;
/** Лежит и не встаёт — напоминаем раз в полчаса: иначе о включённом VPN легко забыть. */
const REMIND_MS = 30 * 60_000;
/** Пульс бота старше этого — он завис. Пульс пишется раз в 30 с, запас большой. */
const STALE_MS = 5 * 60_000;
/** Столько непрочитанных апдейтов значит, что бот не вызывает getUpdates. */
const PENDING_LIMIT = 5;

// Только факты: текст личных сообщений в лог не попадает (инвариант 7), токен в ошибках — вырезаем.
const redact = (s: string) => s.split(config.botToken).join("<BOT_TOKEN>");
const log = (line: string) => appendFileSync(LOG_FILE, `${formatTime(new Date().toISOString())} ${redact(line)}\n`);
const detail = (err: unknown) => redact(err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 120);

const running = () =>
  new Promise<boolean>((resolve) => {
    // pgrep выходит с 1, когда никого не нашёл: это не ошибка запуска, а «бот не запущен».
    const p = spawn("/usr/bin/pgrep", ["-f", `${process.cwd()}/node_modules/tsx/dist/cli.mjs src/index.ts`], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });

/**
 * Бот жив не тогда, когда есть процесс, а когда работает его polling.
 * 2 ноября 2026 процесс висел, а `getUpdates` не вызывался — снаружи бот был мёртв.
 * Поэтому смотрим два признака: процесс есть И пульс (data/heartbeat) свежий.
 */
async function checkBot(): Promise<string | undefined> {
  if (!(await running())) return "процесс не найден";
  try {
    const beat = Number(readFileSync(HEARTBEAT_FILE, "utf8"));
    const age = Date.now() - beat;
    // Пульс пишется раз в 30 с; 5 минут — с большим запасом на паузу мака и медленный диск.
    if (!Number.isFinite(beat) || age > STALE_MS) return `завис: пульс ${Math.round(age / 60_000)} мин назад`;
  } catch {
    return "жив, но пульса нет — перезапусти бота";
  }
  return undefined;
}

/**
 * Сеть до Telegram: одинаково ловит и выключенный Wi-Fi, и забаненный VPN-адрес.
 * Заодно — застой апдейтов: если они копятся, бот не читает Telegram, даже когда процесс жив.
 */
async function checkTelegram(): Promise<string | void> {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
  const info = (await res.json()) as { result?: { pending_update_count?: number } };
  const pending = info.result?.pending_update_count ?? 0;
  // Один-два апдейта — норма (бот их ещё не забрал). Десятки — он не читает.
  if (pending >= PENDING_LIMIT) return `апдейты копятся: ${pending} непрочитанных — polling не работает`;
}

/** Туннель: публичный адрес должен отвечать. Заголовок — чтобы ngrok не отдал заглушку вместо ответа. */
async function checkTunnel(): Promise<void> {
  if (!URL) return;
  const res = await fetch(URL, { headers: { "ngrok-skip-browser-warning": "1" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function sample(): Promise<Checks> {
  // Функция возвращает причину поломки строкой (undefined — всё хорошо) или бросает исключение.
  const settle = async (fn: () => Promise<string | void>) => {
    try {
      const why = await fn();
      return why ? { ok: false, detail: why } : { ok: true, detail: "—" };
    } catch (err) {
      return { ok: false, detail: detail(err) };
    }
  };
  const [bot, telegram, tunnel] = await Promise.all([settle(checkBot), settle(checkTelegram), settle(checkTunnel)]);
  return { bot, telegram, tunnel };
}

function readState(): MonitorState | undefined {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8")) as MonitorState;
  } catch {
    return undefined; // первый запуск
  }
}

/**
 * В группу и в личку админу; не задано ни то ни другое — молча.
 * Возвращает true, если сообщение дошло хотя бы куда-то: тогда о поломке можно не повторять.
 */
async function send(text: string): Promise<boolean> {
  const where = [CHAT, ADMIN].filter((id, i, all) => id > 0 && all.indexOf(id) === i);
  let delivered = false;
  await Promise.all(
    where.map(async (id) => {
      try {
        const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: id, text }),
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) delivered = true;
        else log(`не смог отправить в ${id}: HTTP ${res.status} ${(await res.text()).slice(0, 80)}`);
      } catch (err) {
        log(`не смог отправить в ${id}: ${detail(err)}`);
      }
    }),
  );
  return delivered;
}

mkdirSync(dirname(LOG_FILE), { recursive: true });
mkdirSync(dirname(STATE_FILE), { recursive: true });

const now = new Date();
const checks = await sample();
if (process.argv.includes("--status")) {
  console.log(statusText(checks, readState()));
  process.exit(0);
}

const prev = readState();
const { state, broke, fixed, slept } = nextState(prev, checks, now);
if (slept) log("мак спал между запусками — простой не считаем");
for (const k of broke) log(`отвалилось: ${k} (${checks[k].detail})`);
for (const k of fixed) log(`вернулось: ${k}`);

// Зависший бот сам не оживёт: launchd видит живой процесс и не трогает его. Перезапускаем, пока он лежит,
// но не чаще раза в 10 минут — иначе бот, падающий сразу после старта, попал бы в карусель перезапусков.
// Важно: условие — «бот лежит сейчас», а не «только что сломался»: зависший бот не чинится сам,
// и после первого сообщения переход broke больше не повторится.
if (shouldRestartBot(checks, state, now)) {
  log(`перезапускаю бота (${checks.bot.detail})`);
  state.lastRestart = now.toISOString();
  const p = spawn("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid?.() ?? 501}/com.engbot.bot`], { stdio: "ignore" });
  await new Promise((r) => p.on("close", r));
}

// Сообщение о поломке — с подтверждения (nextState), починку объявляем сразу: её видно надёжно.
// Отмечаем «сообщили» только когда сообщение реально ушло: иначе тревога потерялась бы именно тогда,
// когда сеть лежит вместе с ботом.
if (broke.length) {
  if (await send(problemText(broke, checks, now))) markNotified(state, broke);
} else if (fixed.length) await send(recoveryText(fixed, prev?.downSince ?? {}, checks, now));
// О простое уже сообщили, а он не кончается: напоминаем, чтобы не забыть включить VPN обратно.
else if (downKinds(checks).some((k) => state.notified[k])) {
  const lastNotice = Date.parse(prev?.lastNotice ?? "") || now.getTime();
  if (now.getTime() - lastNotice > REMIND_MS) {
    if (await send(problemText(downKinds(checks).filter((k) => state.notified[k]), checks, now))) {
      state.lastNotice = now.toISOString();
    }
  }
}
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
