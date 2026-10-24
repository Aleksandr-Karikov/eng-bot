import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { isValid, parse } from "@telegram-apps/init-data-node";
import type { Api } from "grammy";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { undoAnswer } from "../services/review";
import { QUEUE_MODES, appAnswer, appAudio, appDrillAnswer, appMe, appProgress, appPicture, appQueue, appTriage, appTriageQueue, appUser, ownWord } from "./api";
import { appCheck, appSaveMistakes } from "./exercises";
import { sendLesson } from "../bot/handlers/lesson";
import { appAddWord, appChangeSetting, appEditWord, appPrepareWord, appSettings, appWordAction, appWordDetails, appWords, memberWord, type WordAction } from "./manage";

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
  const app = new Hono<{ Variables: { user: User } }>();

  app.use("/api/*", async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const initData = header.startsWith("tma ") ? header.slice(4) : "";
    const telegramId = initData && isValid(initData, ctx.botToken) ? parse(initData).user?.id : undefined;
    const user = telegramId !== undefined ? await appUser(deps, telegramId) : undefined;
    if (!user) return c.json({ ok: false, error: "Открой приложение из бота" }, 401);
    c.set("user", user);
    await next();
  });

  app.get("/api/me", async (c) => c.json({ ok: true, ...(await appMe(deps, c.get("user"))) }));
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
    return c.json({ ok: true, status: await sendLesson(deps, ctx.api, c.get("user")) });
  });
  app.get("/api/progress", async (c) => c.json({ ok: true, ...(await appProgress(deps, c.get("user"))) }));
  // 🧠 Ответ на вопрос по ошибкам из очереди.
  app.post("/api/drill", async (c) => {
    const r = await appDrillAnswer(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400);
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
    const word = await mediaWord(c, c.get("user"));
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
    return word ? c.json({ ok: true, word: await appWordDetails(deps, c.get("user"), word) }) : c.json({ ok: false, error: "Этого слова уже нет" }, 404);
  });
  app.post("/api/words/:id/edit", async (c) => {
    const word = await memberWord(deps, c.get("user"), Number(c.req.param("id")));
    if (!word) return c.json({ ok: false, error: "Этого слова уже нет" }, 404);
    const r = await appEditWord(deps, word, await c.req.json().catch(() => ({})));
    return c.json(r, r.ok ? 200 : 400);
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

  // Сервер расширения — через тот же адрес (/ext/…), чтобы хватало одного туннеля ngrok.
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

/** Только 127.0.0.1: снаружи — через ngrok (или туннель/хостинг), который пробрасывает этот порт. */
export function startAppServer(ctx: AppContext, port: number): ServerType {
  const server = serve({ fetch: createApp(ctx).fetch, port, hostname: "127.0.0.1" }, () => console.log(`Mini App on http://127.0.0.1:${port}/app/`));
  // Порт занят или запрещён (ниже 1024 без прав) — без приложения, но бот продолжает работать.
  server.on("error", (err) => console.error(`Mini App server failed on port ${port}`, err));
  return server;
}
