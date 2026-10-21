import { serve, type ServerType } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { isValid, parse } from "@telegram-apps/init-data-node";
import type { Api } from "grammy";
import { Hono } from "hono";
import { proxy } from "hono/proxy";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { appAnswer, appAudio, appMe, appPicture, appQueue, appUser } from "./api";

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
  app.get("/api/queue", async (c) => c.json({ ok: true, cards: await appQueue(deps, c.get("user")) }));
  app.post("/api/answer", async (c) => {
    const r = await appAnswer(deps, c.get("user"), await c.req.json().catch(() => ({})));
    return c.json(r.body, r.status as 200 | 400);
  });
  app.get("/api/audio", async (c) => {
    const audio = await appAudio(deps, c.get("user"), Number(c.req.query("card")), c.req.query("accent") === "us" ? "us" : "uk");
    return audio ? c.body(new Uint8Array(audio), 200, { "content-type": "audio/mp4", "cache-control": "private, max-age=86400" }) : c.notFound();
  });
  app.get("/api/picture", async (c) => {
    const png = await appPicture(deps, ctx.api, c.get("user"), Number(c.req.query("card")));
    return png ? c.body(new Uint8Array(png), 200, { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" }) : c.notFound();
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
