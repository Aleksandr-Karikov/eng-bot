import { describe, expect, it } from "vitest";
import { QUOTAS, quotaUsed } from "../src/services/limits";
import { recordMistakes } from "../src/services/mistakes";
import { createRoom } from "../src/services/rooms";
import { saveWord } from "../src/services/words";
import { makeUser, T0, at, DAY } from "./helpers";
import { botHarness } from "./bot-harness";

/**
 * Лимиты тяжёлых команд (docs/limits.md).
 *
 * Проверяется не «счётчик вырос», а поведение: команда работает, на пределе отвечает отказом, на
 * следующий день снова работает. Счётчик — деталь; человек видит именно это.
 */

const MSK = "Europe/Moscow";

/** Сколько раз позвать команду и сколько отказов насчитать. */
async function spam(h: ReturnType<typeof botHarness>, times: number, update: () => ReturnType<ReturnType<typeof botHarness>["message"]>) {
  for (let i = 0; i < times; i++) await h.bot.handleUpdate(update());
}

const texts = (h: ReturnType<typeof botHarness>) =>
  h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text ?? ""));

const refused = (h: ReturnType<typeof botHarness>, kind: keyof typeof QUOTAS) =>
  texts(h).some((t) => t.includes(QUOTAS[kind].refusal));

describe("лимиты: тяжёлые команды", () => {
  it("/check считает проверки и отказывает на пределе", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    const limit = QUOTAS.check.limit;

    await spam(h, limit, () => h.message(100, "/check he go to work"));
    expect(refused(h, "check")).toBe(false);
    expect(await quotaUsed(h.db, { userId: 1, kind: "check", timeZone: MSK, now: T0 })).toBe(limit);

    await h.bot.handleUpdate(h.message(100, "/check one more"));
    expect(refused(h, "check")).toBe(true);
  });

  it("/check считает того, кто просит, а не автора текста", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await makeUser(h.db, 200);

    // 200 просит проверить текст 100 — попытка должна лечь на 200.
    await h.bot.handleUpdate(h.replyTo(200, "/check", { messageId: 1, fromId: 100, text: "he go" }));

    expect(await quotaUsed(h.db, { userId: 1, kind: "check", timeZone: MSK, now: T0 })).toBe(0);
    expect(await quotaUsed(h.db, { userId: 2, kind: "check", timeZone: MSK, now: T0 })).toBe(1);
  });

  it("👀-реакция упирается в тот же лимит, а не обходит его", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    for (let i = 0; i < QUOTAS.check.limit; i++) {
      await h.bot.handleUpdate(h.message(100, "/check he go"));
    }

    // Реакция на сообщение, которое бот видел: раньше это был бесплатный путь к модели.
    const seen = h.groupMessage(100, -500, "he go to work");
    await h.bot.handleUpdate(seen);
    h.calls.length = 0;
    await h.bot.handleUpdate({
      update_id: 9999,
      message_reaction: {
        chat: { id: -500, type: "supergroup", title: "G" },
        message_id: seen.message!.message_id,
        date: 0,
        old_reaction: [],
        new_reaction: [{ type: "emoji", emoji: "👀" }],
        user: { id: 100, is_bot: false, first_name: "User100" },
      },
    } as never);

    expect(refused(h, "check")).toBe(true);
  });

  it("/check отказывает в группе, и отказ не накручивает счётчик", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    const limit = QUOTAS.check.limit;
    for (let i = 0; i < limit; i++) {
      await h.bot.handleUpdate(h.groupMessage(100, -500, "/check he go"));
    }

    h.calls.length = 0;
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/check he go"));

    // Отказ уходит в тот же чат, где просили, — и ровно одним сообщением.
    const sent = h.calls.filter((c) => c.method === "sendMessage");
    expect(sent).toHaveLength(1);
    expect(sent[0].payload.chat_id).toBe(-500);
    expect(String(sent[0].payload.text)).toContain(QUOTAS.check.refusal);
    // Настойчивость не сдвигает счётчик: он так и остался на пределе.
    expect(await quotaUsed(h.db, { userId: 1, kind: "check", timeZone: MSK, now: T0 })).toBe(limit);
  });

  it("/talk считает разговоры, а не реплики", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    const limit = QUOTAS.talk.limit;

    await spam(h, limit, () => h.message(100, "/talk about pizza"));
    expect(refused(h, "talk")).toBe(false);

    // Реплики внутри разговора лимит не тратят: модель зовётся на каждую, но разговор уже начат.
    await h.bot.handleUpdate(h.message(100, "I like pizza"));
    expect(await quotaUsed(h.db, { userId: 1, kind: "talk", timeZone: MSK, now: T0 })).toBe(limit);

    await h.bot.handleUpdate(h.message(100, "/talk about pasta"));
    expect(refused(h, "talk")).toBe(true);
  });

  it("/talk отказывает в группе тем же текстом, что и в личке", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/talk about pizza"));
    // В группе команда всё равно отказывает — но по своей причине («поговорить можно в личке»), и попытку не тратит.
    expect(await quotaUsed(h.db, { userId: 1, kind: "talk", timeZone: MSK, now: T0 })).toBe(0);
  });

  it("/story отказывает до генерации, а не после", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    for (let i = 0; i < QUOTAS.story.limit; i++) {
      await h.bot.handleUpdate(h.message(100, "/story"));
    }
    h.calls.length = 0;
    await h.bot.handleUpdate(h.message(100, "/story"));

    expect(refused(h, "story")).toBe(true);
    // «Пишу историю…» — признак того, что работа началась. При отказе её быть не должно.
    expect(texts(h).some((t) => t.includes("Пишу историю"))).toBe(false);
  });

  it("/say не тратит попытку на пустую команду", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    await h.bot.handleUpdate(h.message(100, "/say"));
    expect(await quotaUsed(h.db, { userId: 1, kind: "say", timeZone: MSK, now: T0 })).toBe(0);

    await h.bot.handleUpdate(h.message(100, "/say неудобно получилось"));
    expect(await quotaUsed(h.db, { userId: 1, kind: "say", timeZone: MSK, now: T0 })).toBe(1);
  });

  it("/text считает разборы и отказывает после предела", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    for (let i = 0; i < QUOTAS.text.limit; i++) {
      await h.bot.handleUpdate(h.message(100, "/text it was pure serendipity"));
    }
    expect(refused(h, "text")).toBe(false);

    await h.bot.handleUpdate(h.message(100, "/text another one"));
    expect(refused(h, "text")).toBe(true);
  });

  it("на следующий день лимит снова полный", async () => {
    const h = botHarness();
    await makeUser(h.db, 100);
    for (let i = 0; i < QUOTAS.check.limit; i++) await h.bot.handleUpdate(h.message(100, "/check he go"));
    await h.bot.handleUpdate(h.message(100, "/check he go"));
    expect(refused(h, "check")).toBe(true);

    h.setNow(at(DAY));
    h.calls.length = 0;
    await h.bot.handleUpdate(h.message(100, "/check he go"));
    expect(refused(h, "check")).toBe(false);
  });

  it("/drill не тратит попытку, когда вопросы уже готовы", async () => {
    // Три вопроса: первый показывается сразу, остальные остаются в памяти — их и раздаёт второй /drill.
    const questions = [0, 1, 2].map((i) => ({ question: `q${i}?`, options: ["a", "b"], correct: 0, explanation: "", category: "t" }));
    let generated = 0;
    const base = botHarness().deps.tutor;
    const h = botHarness({
      tutor: {
        ...base,
        drill: async () => {
          generated++;
          return questions;
        },
      },
    });
    const user = await makeUser(h.db, 100);
    // Без записанных ошибок `prepareDrill` выходит до вызова модели — тогда лимит и не должен тратиться.
    await recordMistakes(h.db, user.id, [{ wrong: "he go", right: "he goes", category: "время" }], T0);

    await h.bot.handleUpdate(h.message(100, "/drill"));
    // Вопросы сгенерированы — попытка потрачена.
    expect(generated).toBe(1);
    expect(await quotaUsed(h.db, { userId: user.id, kind: "drill", timeZone: MSK, now: T0 })).toBe(1);

    // Второй раз вопросы уже в памяти: модель не зовётся, и лимит трогать не за что.
    await h.bot.handleUpdate(h.message(100, "/drill"));
    expect(generated).toBe(1);
    expect(await quotaUsed(h.db, { userId: user.id, kind: "drill", timeZone: MSK, now: T0 })).toBe(1);
  });

  it("/audio не тратит попытку на озвучку из кэша", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 100);
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const saved = await saveWord(h.db, {
      roomId: room.id,
      addedBy: user.id,
      draft: { term: "serendipity", translation: "удача", explanation: "", example: "" },
      now: T0,
    });
    if (saved.status !== "saved") throw new Error("dup");

    // Первое нажатие синтезирует и тратит попытку.
    await h.bot.handleUpdate(h.callback(100, `a:${saved.word.id}:u`));
    expect(await quotaUsed(h.db, { userId: user.id, kind: "audio", timeZone: MSK, now: T0 })).toBe(1);

    // Второе отдаёт file_id из Telegram: синтеза нет — и лимит трогать не за что.
    await h.bot.handleUpdate(h.callback(100, `a:${saved.word.id}:u`));
    expect(await quotaUsed(h.db, { userId: user.id, kind: "audio", timeZone: MSK, now: T0 })).toBe(1);
    expect(h.calls.filter((c) => c.method === "sendVoice")).toHaveLength(2);
  });
});
