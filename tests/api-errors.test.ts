import { describe, expect, it } from "vitest";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { botHarness } from "./bot-harness";
import { makeUser, T0 } from "./helpers";

const TOKEN = "123:test-token";

/**
 * Тексты ошибок API уходят человеку: клиент Mini App показывает `body.error` как есть
 * (`app/src/api.ts`). Поэтому они по-русски и говорят, что делать, — а не `bad answer` (E34).
 */
async function api() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100, "A")).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  await updateUser(h.db, user.id, { currentRoomId: room.id });
  const app = createApp({ deps: h.deps, botToken: TOKEN });
  const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "A" } }, TOKEN, new Date())}` };
  const post = async (path: string, body: object) =>
    (await app.request(path, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<{ error?: string }>;
  return { post };
}

describe("ошибки API по-русски и с действием (E34)", () => {
  it("неверный ответ на карточку объясняет, что делать", async () => {
    const { post } = await api();
    const body = await post("/api/answer", { cardId: "нет", reps: 0, answer: "good" });
    expect(body.error).toBeDefined();
    // Никакой латиницы в техническом смысле: только кириллица и знаки.
    expect(body.error).toMatch(/[а-яё]/i);
    expect(body.error).not.toMatch(/^bad /);
    expect(body.error).toContain("попробуй");
  });

  it("неверное действие при первом показе тоже по-русски", async () => {
    const { post } = await api();
    const body = await post("/api/answer", { answer: "drop", cardId: 1, reps: 1 });
    expect(body.error).toMatch(/[а-яё]/i);
    expect(body.error).not.toMatch(/^bad /);
  });

  it("ни один ответ API не начинается с «bad »", async () => {
    const { post } = await api();
    const cases = [
      await post("/api/answer", { cardId: "x", reps: 0, answer: "good" }),
      await post("/api/words/1/x", {}),
      await post("/api/sets/target", { roomId: "x" }),
    ];
    for (const body of cases) {
      if (body.error) expect(body.error).not.toMatch(/^bad /);
    }
  });
});
