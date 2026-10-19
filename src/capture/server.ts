import { createServer, type IncomingMessage, type Server } from "node:http";
import { getRoom } from "../services/rooms";
import type { Deps } from "../bot/context";
import { capture, userByCaptureKey, type CaptureBroadcaster, type CaptureInput } from "./capture";

const MAX_BODY = 16 * 1024;

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Приём слов из расширения браузера. Слушает только 127.0.0.1 — снаружи Мака недоступен;
 * кто есть кто — по личному ключу из /extension.
 */
export function startCaptureServer(deps: Deps, broadcaster: CaptureBroadcaster, port: number): Server {
  const server = createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json; charset=utf-8",
        // Без CORS-заголовков: расширение ходит из service worker по host_permissions, а открытым
        // страницам незачем уметь обращаться к боту на localhost.
      });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "OPTIONS") return send(204, {});
      if (req.method === "GET" && url.pathname === "/ping") {
        const user = await userByCaptureKey(deps, url.searchParams.get("key") ?? "");
        if (!user) return send(401, { ok: false, error: "Неверный ключ — возьми новый в боте: /extension" });
        const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
        return send(200, { ok: true, name: user.firstName, room: room?.name ?? null });
      }
      if (req.method === "POST" && url.pathname === "/capture") {
        const body = (await readJson(req)) as Partial<CaptureInput>;
        const input: CaptureInput = {
          key: String(body.key ?? ""),
          text: typeof body.text === "string" ? body.text : "",
          context: typeof body.context === "string" ? body.context : "",
          title: typeof body.title === "string" ? body.title.slice(0, 200) : "",
        };
        const result = await capture(deps, broadcaster, input);
        return send(result.ok ? 200 : result.status, result);
      }
      send(404, { ok: false, error: "not found" });
    } catch (err) {
      console.error("Capture request failed", err);
      send(500, { ok: false, error: "Ошибка в боте — посмотри логи" });
    }
  });
  server.listen(port, "127.0.0.1", () => console.log(`Capture server on http://127.0.0.1:${port}`));
  server.on("error", (err) => console.error("Capture server failed", err));
  return server;
}
