import { randomUUID } from "node:crypto";
import { getRoom } from "../services/rooms";
import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { isValid, parse } from "@telegram-apps/init-data-node";
import type { Api } from "grammy";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { undoAnswer } from "../services/review";
import { adoptDeviceTimeZone } from "../services/users";
import { isTimeZone } from "../time";
import { exampleTranslation } from "../services/words";
import { QUEUE_MODES, appAnswer, appAudio, appBoss, appBuyUpgrade, appCombat, appGrammar, appGrammarAnswer, appGrammarTopic, appSetDecide, appSetItems, appSetSetTarget, appSetTarget, appSets, setItemForAudio, appDrillAnswer, appMe, appProgress, appPicture, appQueue, appTriage, appTriageQueue, appUser, ownWord } from "./api";
import { appCheck, appSaveMistakes } from "./exercises";
import { sendLesson } from "../bot/handlers/lesson";
import { appCorrectWord, appApplyCorrection, correctionEffects, type CorrectionDraft, appAddWord, appChangeSetting, appEditWord, appNewMnemonic, appPrepareWord, appSettings, appWordAction, appWordDetails, appWords, memberWord, type WordAction } from "./manage";

export interface AppContext {
  deps: Deps;
  api?: Api;
  botToken: string;
}

/**
 * Mini App: страница (собранный Vite в app/dist) и её API. Кто пользователь — только по подписанным
 * Telegram данным запуска (initData), проверка — @telegram-apps/init-data-node, без своих логинов.
 */
export function createApp(ctx: AppContext): Hono<{ Variables: { user: User } }> {
  const { deps } = ctx;
  // Один черновик на пользователя; после перезапуска нужно запросить предложение заново.
  const corrections = new Map<number, CorrectionDraft>();
  const app = new Hono<{ Variables: { user: User } }>();

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const initData = header.startsWith("tma ") ? header.slice(4) : "";
    const telegramId = initData && isValid(initData, ctx.botToken) ? parse(initData).user?.id : undefined;
    const user = telegramId !== undefined ? await appUser(deps, telegramId) : undefined;
    if (!user) return c.json({ ok: false, error: "Открой приложение из бота" }, 401);
    c.set("user", user);
    // Как в боте: язык запроса — язык текущей комнаты (lang.ts).
    const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
    await next();
  });

  app.get("/api/me", async (c) => c.json({ ok: true, ...(await appMe(deps, c.get("user"))) }));
  /**
   * Пояс с телефона. Telegram его не отдаёт, поэтому единственный честный источник — приложение:
   * оно присылает `Intl.DateTimeFormat().resolvedOptions().timeZone` при запуске.
   */
  app.post("/api/timezone", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { timezone?: unknown };
    const timezone = typeof body.timezone === "string" ? body.timezone.slice(0, 100) : "";
    // Мусор и опечатки не пишем: неизвестный пояс сделал бы неделю невычислимой.
    if (!timezone || !isTimeZone(timezone)) return c.json({ ok: false, error: "Неизвестный часовой пояс" }, 400);
    await adoptDeviceTimeZone(deps.db, c.get("user").id, timezone);
    return c.json({ ok: true, timezone });
  });
  // Ошибки с телефона (кнопки Telegram, плеер…) — в лог бота, коротко.
  app.post("/api/client-error", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const field = (k: string, max: number) => (typeof body[k] === "string" ? (body[k] as string).slice(0, max) : "");
    console.error(`App client error (${c.get("user").firstName}): ${field("where", 100)}: ${field("message", 500)} — ${field("ua", 200)}`);
    return c.json({ ok: true });
  });
  app.get("/api/queue", async (c) => {
    const mode = QUEUE_MODES.find((m) => m === c.req.query("mode")) ?? "all";
    return c.json({ ok: true, cards: await appQueue(deps, c.get("user"), mode) });
  });
  app.post("/api/answer", async (c) => {
    const r = await appAnswer(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400);
  });
  // 🆕 Новые слова от друзей: колода и решение по карточке (или его отмена — undo: true).
  app.get("/api/triage", async (c) => c.json({ ok: true, cards: await appTriageQueue(deps, c.get("user")) }));
  app.post("/api/triage", async (c) => {
    const r = await appTriage(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 409);
  });
  // ✍️ 🎧 Ответ текстом: проверка и оценка карточки; «Сохранить ошибки» после разбора своего предложения.
  app.post("/api/check", async (c) => {
    const r = await appCheck(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 404 | 409);
  });
  app.post("/api/mistakes", async (c) => {
    const r = await appSaveMistakes(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 404);
  });
  // 🎧 Аудиоурок — в личку от бота (Telegram играет его в фоне, приложение так не умеет).
  app.post("/api/lesson", async (c) => {
    if (!ctx.api) return c.json({ ok: false, error: "Бот недоступен" }, 503);
    const body = (await c.req.json().catch(() => ({}))) as { accent?: unknown };
    const accent = body.accent === "uk" || body.accent === "us" ? body.accent : "mix";
    return c.json({ ok: true, status: await sendLesson(deps, ctx.api, c.get("user"), accent) });
  });
  app.get("/api/progress", async (c) => c.json({ ok: true, ...(await appProgress(deps, c.get("user"))) }));
  // 📘 Грамматика: список тем, тема целиком и проверка ответа. Проверка без модели — сравнение строк.
  app.get("/api/grammar", async (c) => c.json({ ok: true, ...(await appGrammar(deps, c.get("user"))) }));
  app.get("/api/grammar/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id)) return c.json({ ok: false, error: "Нет такой темы" }, 404);
    const topic = await appGrammarTopic(deps, c.get("user"), id);
    return topic ? c.json({ ok: true, topic }) : c.json({ ok: false, error: "Тема не найдена" }, 404);
  });
  app.post("/api/grammar/answer", async (c) => {
    const r = await appGrammarAnswer(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 404);
  });
  // 🐉 Вкладка босса: цель комнаты, показанная боем (services/boss.ts).
  app.get("/api/boss", async (c) => c.json({ ok: true, ...(await appBoss(deps, c.get("user"))) }));
  app.post("/api/boss/combat", async (c) => {
    const r = await appCombat(deps, c.get("user"), await c.req.json().catch(() => null));
    return c.json(r.body, r.status);
  });
  // 🪙 Купить уровень усиления за монеты недели.
  app.post("/api/boss/upgrade", async (c) => {
    const r = await appBuyUpgrade(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json({ ...r.body, ...(r.status === 200 && r.user ? await appBoss(deps, r.user) : {}) }, r.status as 200 | 400);
  });
  // 🧠 Ответ на вопрос по ошибкам из очереди.
  app.post("/api/drill", async (c) => {
    const r = await appDrillAnswer(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400);
  });
  // 📦 Готовые наборы слов.
  app.get("/api/sets", async (c) => c.json({ ok: true, ...await appSets(deps, c.get("user")) }));
  app.post("/api/sets/decide", async (c) => {
    const r = await appSetDecide(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 409);
  });
  // 📍 Куда «учу» кладёт слово: показать и сменить комнату. Регистрируется ДО `/api/sets/:id`,
  // иначе «target» разобрался бы как id набора и отдал 404.
  app.get("/api/sets/target", async (c) => c.json(await appSetTarget(deps, c.get("user"))));
  app.post("/api/sets/target", async (c) => {
    const r = await appSetSetTarget(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 409);
  });
  app.get("/api/sets/:id", async (c) => {
    const r = await appSetItems(deps, c.get("user"), Number(c.req.param("id")));
    return r ? c.json({ ok: true, ...r }) : c.json({ ok: false, error: "Нет такого набора" }, 404);
  });
  // ↩️ Отменить последний свайп: карточка — как до ответа.
  app.post("/api/undo", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { cardId?: unknown };
    const undone = await undoAnswer(deps.db, { userId: c.get("user").id, cardId: Number(body.cardId) });
    return undone ? c.json({ ok: true }) : c.json({ ok: false, error: "Этот ответ уже не отменить" }, 409);
  });
  /** Слово для озвучки и картинки: из своей карточки (?card=) или из своей комнаты (?word=, страница слова). */
  const mediaWord = (c: { req: { query: (k: string) => string | undefined } }, user: User) =>
    c.req.query("word") ? memberWord(deps, user, Number(c.req.query("word"))) : ownWord(deps, user, Number(c.req.query("card")));
  app.get("/api/audio", async (c) => {
    const word = c.req.query("item") ? await setItemForAudio(deps, Number(c.req.query("item"))) : await mediaWord(c, c.get("user"));
    if (!word) return c.notFound();
    const audio = await appAudio(deps, word, c.req.query("accent") === "us" ? "us" : "uk");
    return c.body(new Uint8Array(audio), 200, { "content-type": "audio/mp4", "cache-control": "private, max-age=86400" });
  });
  app.get("/api/picture", async (c) => {
    const word = await mediaWord(c, c.get("user"));
    const jpeg = word && (await appPicture(deps, ctx.api, word));
    return jpeg ? c.body(new Uint8Array(jpeg), 200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" }) : c.notFound();
  });

  // 📖 Слова и ⚙️ Настройки — те же правила, что у кнопок в боте.
  app.get("/api/words", async (c) => c.json({ ok: true, ...(await appWords(deps, c.get("user"))) }));
  // ➕ Новое слово: черновик (перевод готовит модель), потом сохранение. Раньше /api/words/:id — иначе «prepare» стал бы id.
  app.post("/api/words/prepare", async (c) => {
    const r = await appPrepareWord(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 409 | 422);
  });
  app.post("/api/words", async (c) => {
    const r = await appAddWord(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400 | 409);
  });
  app.get("/api/words/:id", async (c) => {
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    // Человек открыл слово — самое время подготовить часть речи и родню, если их ещё нет.
    if (word) void deps.grammarGen.ensure(word);
    return word ? c.json({ ok: true, word: await appWordDetails(deps, c.get("user"), word) }) : c.json({ ok: false, error: "Этого слова уже нет" }, 404);
  });
  app.post("/api/words/:id/edit", async (c) => {
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    const r = await appEditWord(deps, word, await c.req.json().catch(() => ({})));
    return c.json(r, r.ok ? 200 : 400);
  });
  app.post("/api/words/:id/correct", async (c) => {
    const user = c.get("user");
    const word = await memberWord(deps, user, Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.instruction !== "string" || !body.instruction.trim() || body.instruction.length > 1000) {
      return c.json({ ok: false, error: "Опиши исправление: от 1 до 1000 символов" }, 400);
    }
    const now = deps.now().getTime();
    for (const [id, draft] of corrections) if (draft.expiresAt <= now) corrections.delete(id);
    const previous = body.draftId ? corrections.get(user.id) : undefined;
    if (body.draftId && (!previous || previous.id !== body.draftId || previous.before.id !== word.id)) {
      return c.json({ ok: false, error: "Черновик устарел. Запроси исправление заново" }, 409);
    }
    if ((previous?.instruction.length ?? 0) + body.instruction.length > 10000) {
      return c.json({ ok: false, error: "Слишком много уточнений. Начни исправление заново" }, 400);
    }
    try {
      const proposed = await appCorrectWord(deps, word, body.instruction.trim(), previous);
      const draft: CorrectionDraft = { ...proposed, id: randomUUID(), userId: user.id, expiresAt: deps.now().getTime() + 30 * 60_000 };
      corrections.set(user.id, draft);
      return c.json({ ok: true, draftId: draft.id, message: draft.message,
        before: await appWordDetails(deps, user, draft.before), after: await appWordDetails(deps, user, draft.after),
        effects: correctionEffects(draft.before, draft.after),
      });
    } catch (err) {
      console.error("App correction failed", err instanceof Error ? err.name : "unknown error");
      return c.json({ ok: false, error: "Не получилось подготовить правку — попробуй ещё раз. Карточка не изменена" }, 502);
    }
  });
  app.post("/api/words/:id/correct/apply", async (c) => {
    const user = c.get("user");
    const word = await memberWord(deps, user, Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    const body = await c.req.json().catch(() => null);
    const draft = corrections.get(user.id);
    if (!draft || draft.id !== body?.draftId || draft.before.id !== word.id || draft.expiresAt <= deps.now().getTime()) {
      return c.json({ ok: false, error: "Черновик устарел. Запроси исправление заново" }, 409);
    }
    const r = await appApplyCorrection(deps, draft);
    if (r.status === 200 && corrections.get(user.id)?.id === draft.id) corrections.delete(user.id);
    return c.json(r.body, r.status as 200 | 409);
  });
  // 🇷🇺 Перевод примера в карточке — по тапу; готовый хранится в слове, модель спрашиваем один раз.
  app.post("/api/words/:id/example", async (c) => {
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    if (!word?.example) return c.json({ ok: false, error: "У этого слова нет примера" }, 404);
    try {
      return c.json({ ok: true, translation: await exampleTranslation(deps.db, deps.enricher, word) });
    } catch (err) {
      console.error("Example translation failed", word.id, err instanceof Error ? err.name : "unknown error");
      return c.json({ ok: false, error: "Не получилось перевести пример — попробуй ещё раз" }, 502);
    }
  });
  app.post("/api/words/:id/mnemonic", async (c) => {
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    const r = await appNewMnemonic(deps, c.get("user"), word);
    return c.json(r.body, r.status as 200 | 429 | 502);
  });
  const ACTIONS = new Set<WordAction>(["drop", "restore", "promote", "delete"]);
  app.post("/api/words/:id/:action", async (c) => {
    const action = c.req.param("action") as WordAction;
    if (!ACTIONS.has(action)) return c.json({ ok: false, error: "Непонятное действие" }, 400);
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    await appWordAction(deps, c.get("user"), word, action);
    return c.json({ ok: true });
  });
  app.get("/api/settings", async (c) => c.json({ ok: true, settings: await appSettings(deps, c.get("user")) }));
  app.post("/api/settings", async (c) => {
    const r = await appChangeSetting(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return r.ok ? c.json({ ok: true, settings: await appSettings(deps, r.user) }) : c.json(r, 400);
  });

  // Сервер расширения — через тот же публичный адрес (/ext/…), что и Mini App.
  if (deps.capturePort) {
    app.all("/ext/*", (c) => {
      const url = new URL(c.req.url);
      return proxy(`http://127.0.0.1:${deps.capturePort}${url.pathname.slice(4)}${url.search}`, { ...c.req, headers: { "content-type": c.req.header("content-type") ?? "" } });
    });
  }

  app.get("/", (c) => c.redirect("/app/"));
  // APP_URL часто пишут без «/» на конце — относительные пути к файлам приложения тогда бы сломались.
  app.get("/app", (c) => c.redirect("/app/"));
  app.use("/app/*", serveStatic({ root: "app/dist", rewriteRequestPath: (p) => p.replace(/^\/app/, "") || "/" }));
  return app;
}

/** Только 127.0.0.1: снаружи — через HTTPS-прокси, который пробрасывает этот порт. */
export function startAppServer(ctx: AppContext, port: number): ServerType {
  const server = serve({ fetch: createApp(ctx).fetch, port, hostname: "127.0.0.1" }, () => console.log(`Mini App on http://127.0.0.1:${port}/app/`));
  // Порт занят или запрещён (ниже 1024 без прав) — без приложения, но бот продолжает работать.
  server.on("error", (err) => console.error(`Mini App server failed on port ${port}`, err));
  return server;
}
