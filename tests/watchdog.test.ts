import { describe, expect, it } from "vitest";
import { downKinds, formatDuration, markNotified, nextState, problemText, recoveryText, shouldRestartBot, statusText, type Checks, type MonitorState } from "../src/services/monitor";
import { T0, at } from "./helpers";
import { readFileSync, unlinkSync } from "node:fs";
const readFileSyncText = (p: string) => readFileSync(p, "utf8");

const ok: Checks = { bot: { ok: true, detail: "—" }, telegram: { ok: true, detail: "—" }, tunnel: { ok: true, detail: "—" } };
/** Лежат перечисленные проверки, остальные — в порядке. */
const down = (...kinds: (keyof Checks)[]): Checks =>
  Object.fromEntries(Object.entries(ok).map(([k, v]) => [k, kinds.includes(k as keyof Checks) ? { ok: false, detail: "процесс не найден" } : v])) as Checks;
const withDetail = (kind: keyof Checks, detail: string): Checks => ({ ...ok, [kind]: { ok: false, detail } });

/** Прогон сторожа: предыдущее состояние + текущий замер. */
const run = (prev: MonitorState | undefined, checks: Checks, now: Date) => nextState(prev, checks, now);

describe("nextState — о поломке сообщаем только после подтверждения", () => {
  it("первый запуск: всё хорошо — ничего не пишет", () => {
    const r = run(undefined, ok, T0);
    expect(r.broke).toEqual([]);
    expect(r.fixed).toEqual([]);
    expect(r.state.downSince).toEqual({});
  });

  it("один провал — тишина, второй подряд — сообщение", () => {
    const first = run(undefined, down("tunnel"), T0);
    expect(first.broke).toEqual([]);
    expect(first.state.downSince.tunnel).toBe(T0.toISOString());

    const second = run(first.state, down("tunnel"), at(60_000));
    expect(second.broke).toEqual(["tunnel"]);
    // Простой считается с первого провала, а не с подтверждения.
    expect(second.state.downSince.tunnel).toBe(T0.toISOString());
  });

  it("лежит долго — сообщение одно, а не каждую минуту", () => {
    let state = run(undefined, down("tunnel"), T0).state;
    const told = run(state, down("tunnel"), at(60_000));
    expect(told.broke).toEqual(["tunnel"]);
    markNotified(told.state, told.broke); // сообщение реально ушло
    state = told.state;
    const again = run(state, down("tunnel"), at(120_000));
    expect(again.broke).toEqual([]);
    expect(again.fixed).toEqual([]);
  });

  it("вернулось — в fixed, простой посчитан с первого провала", () => {
    let state = run(undefined, down("telegram"), T0).state;
    const told = run(state, down("telegram"), at(60_000));
    markNotified(told.state, told.broke);
    state = told.state;
    const back = run(state, ok, at(5 * 60_000));
    expect(back.fixed).toEqual(["telegram"]);
    expect(back.state.downSince).toEqual({});
    expect(recoveryText(back.fixed, state.downSince, ok, at(5 * 60_000))).toContain("простой 5 мин");
  });

  it("моргнуло и вернулось за минуту — ни одного сообщения", () => {
    const blinked = run(run(undefined, ok, T0).state, down("bot"), at(60_000));
    expect(blinked.broke).toEqual([]);
    const back = run(blinked.state, ok, at(120_000));
    expect(back.fixed).toEqual([]);
    expect(back.state.downSince).toEqual({});
  });

  it("несколько поломок сразу — все в одном сообщении", () => {
    const all = down("bot", "telegram", "tunnel");
    const r = run(run(undefined, all, T0).state, all, at(60_000));
    expect(r.broke).toEqual(["bot", "telegram", "tunnel"]);
    expect(problemText(r.broke, all, T0)).toContain("Не работает ничего");
  });

  it("после сна мака простой не считается: «лежало 7 часов» — враньё", () => {
    const before: MonitorState = {
      checks: down("tunnel"),
      downSince: { tunnel: T0.toISOString() },
      failing: { tunnel: 3 },
      notified: { tunnel: true },
      lastRun: T0.toISOString(),
    };
    const r = run(before, ok, at(7 * 60 * 60_000));
    expect(r.slept).toBe(true);
    expect(r.fixed).toEqual([]);
    expect(r.state.downSince).toEqual({});
  });

  it("спал, а после пробуждения всё ещё лежит — сообщает заново", () => {
    const before: MonitorState = {
      checks: down("tunnel"),
      downSince: { tunnel: T0.toISOString() },
      failing: { tunnel: 3 },
      notified: { tunnel: true },
      lastRun: T0.toISOString(),
    };
    const now = at(7 * 60 * 60_000);
    const first = run(before, down("tunnel"), now);
    const second = run(first.state, down("tunnel"), at(7 * 60 * 60_000 + 60_000));
    expect(first.broke).toEqual([]);
    expect(second.broke).toEqual(["tunnel"]);
    expect(second.state.downSince.tunnel).toBe(now.toISOString());
  });

  it("Telegram недоступен в момент поломки — тревога не теряется, повторяем на следующем запуске", () => {
    // Прогон 1-2: поломка подтвердилась, но отправить не смогли (сеть лежит) — notified не ставим.
    let state = run(undefined, down("bot"), T0).state;
    const confirm = run(state, down("bot"), at(60_000));
    expect(confirm.broke).toEqual(["bot"]);
    expect(confirm.state.notified.bot).toBeUndefined(); // отправка не удалась — отметки нет
    // Прогон 3: сеть вернулась — о поломке сообщаем снова, а не молчим.
    const retry = run(confirm.state, down("bot"), at(120_000));
    expect(retry.broke).toEqual(["bot"]);
  });

  it("downKinds — какие именно лежат", () => {
    expect(downKinds(down("bot", "tunnel"))).toEqual(["bot", "tunnel"]);
  });
});

describe("пульс бота — зависание видно снаружи", () => {
  it("пульс пишется тем же числом, что и время", async () => {
    const { touchHeartbeat } = await import("../src/heartbeat");
    const tmp = `data/heartbeat-test-${Date.now()}`;
    touchHeartbeat(tmp, T0);
    expect(readFileSyncText(tmp)).toBe(String(T0.getTime()));
    unlinkSync(tmp);
  });
});

describe("перезапуск зависшего бота", () => {
  const st = (over: Partial<MonitorState> = {}): MonitorState => ({
    checks: ok,
    downSince: {},
    failing: {},
    notified: {},
    lastRun: T0.toISOString(),
    ...over,
  });

  it("бот в порядке — не трогаем", () => {
    expect(shouldRestartBot(ok, st(), T0)).toBe(false);
  });

  it("бот лежит, перезапусков не было — перезапускаем", () => {
    expect(shouldRestartBot(down("bot"), st(), T0)).toBe(true);
  });

  it("только что перезапускали — ждём паузу, а не долбим launchd", () => {
    // Именно этот случай ломался: Date.parse("") давал NaN, и сравнение всегда было false.
    expect(shouldRestartBot(down("bot"), st({ lastRestart: T0.toISOString() }), at(60_000))).toBe(false);
    expect(shouldRestartBot(down("bot"), st({ lastRestart: T0.toISOString() }), at(10 * 60_000 + 1))).toBe(true);
  });

  it("время перезапуска в state битое — всё равно пробуем", () => {
    expect(shouldRestartBot(down("bot"), st({ lastRestart: "не дата" }), T0)).toBe(true);
  });
});

describe("тексты для чата", () => {
  it("длительность по-русски", () => {
    expect(formatDuration(20_000)).toBe("меньше минуты");
    expect(formatDuration(5 * 60_000)).toBe("5 мин");
    expect(formatDuration(90 * 60_000)).toBe("1 ч 30 мин");
    expect(formatDuration(2 * 60 * 60_000)).toBe("2 ч");
  });

  it("отказ ngrok по IP — это ограничение ngrok из России, а не «сломался VPN»", () => {
    const checks = withDetail("tunnel", "HTTP 403 ERR_NGROK_9040: We do not allow agents from your IP address");
    const text = problemText(["tunnel"], checks, T0);
    expect(text).toContain("из России");
    // Совет «включи/выключи VPN» здесь вреден: IPv4 домашнего провайдера ngrok тоже не пускает.
    expect(text).not.toContain("обычно это включённый VPN");
  });

  it("DNS-ошибка подсказывает про сеть, и это одна подсказка", () => {
    const text = problemText(["telegram"], withDetail("telegram", "TypeError: fetch failed: getaddrinfo ENOTFOUND"), T0);
    expect(text).toContain("VPN и Wi-Fi");
    expect(text.match(/проверь/g)).toHaveLength(1);
  });

  it("простое падение без узнаваемой ошибки — без выдуманных подсказок", () => {
    expect(problemText(["bot"], down("bot"), T0)).not.toContain("VPN");
  });

  it("статус без поломок так и говорит", () => {
    expect(statusText(ok, undefined)).toBe("✅ 🤖 Бот — —\n✅ 📡 Telegram — —\n✅ 🌐 Туннель (ngrok / Mini App) — —\nПоломок нет.");
  });

  it("остатки прошлой поломки не выглядят как текущая", () => {
    // Бот уже поднялся, а в state остался след — «Лежит с» показывать нельзя.
    const stale: MonitorState = { checks: ok, downSince: { bot: T0.toISOString() }, failing: {}, notified: {}, lastRun: T0.toISOString() };
    expect(statusText(ok, stale)).toContain("Поломок нет.");
    expect(statusText(ok, stale)).not.toContain("Лежит с");
  });

  it("лежит сейчас — время простоя видно", () => {
    const collapsed: MonitorState = { checks: down("tunnel"), downSince: { tunnel: T0.toISOString() }, failing: { tunnel: 3 }, notified: { tunnel: true }, lastRun: T0.toISOString() };
    expect(statusText(collapsed.checks, collapsed)).toContain("Лежит с: туннель");
  });
});
