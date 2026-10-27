import { describe, expect, it } from "vitest";
import { decodeCb, encodeCb, type Cb } from "../src/bot/callbacks";
import { DraftStore } from "../src/bot/drafts";
import { doneText, draftText, esc, plural, reminderText, statsText } from "../src/bot/texts";

describe("callbacks", () => {
  const all: Cb[] = [
    { k: "know", wordId: 5, knows: true },
    { k: "know", wordId: 5, knows: false },
    { k: "show", cardId: 9, reps: 2 },
    { k: "rate", cardId: 9, reps: 2, answer: "hard" },
    { k: "learn" },
    { k: "draft", id: 3, action: "edit" },
    { k: "room", action: "invite" },
    { k: "roomsw", roomId: 4 },
    { k: "hour", hour: 21 },
  ];
  it("round-trips and fits Telegram's 64-byte limit", () => {
    for (const cb of all) {
      const data = encodeCb(cb);
      expect(data.length).toBeLessThanOrEqual(64);
      expect(decodeCb(data)).toEqual(cb);
    }
  });
  it("rejects garbage", () => {
    expect(decodeCb("zzz")).toBeNull();
    expect(decodeCb("r:1:2:x")).toBeNull();
    expect(decodeCb("s:abc:1")).toBeNull();
  });
});

describe("texts", () => {
  it("escapes HTML in user content", () => {
    expect(esc("R&D <3")).toBe("R&amp;D &lt;3");
    expect(draftText({ term: "<b>", translation: "R&D", explanation: "", example: "" })).toBe("<b>&lt;b&gt;</b> — R&amp;D");
  });
  it("pluralizes in Russian", () => {
    expect([1, 2, 5, 11, 21, 22].map((n) => plural(n, "слово", "слова", "слов"))).toEqual([
      "слово", "слова", "слов", "слов", "слово", "слова",
    ]);
    expect(reminderText(1)).toContain("1 слово ждёт");
    expect(reminderText(12)).toContain("12 слов ждут");
    expect(reminderText({ review: 5, fresh: 12 })).toBe("🔔 5 слов ждут повторения + 12 новых слов");
    expect(reminderText({ review: 0, fresh: 1 })).toBe("🆕 1 новое слово ждёт знакомства");
  });
  it("renders done and stats texts", () => {
    expect(doneText(0, undefined, "Europe/Moscow")).toContain("нечего повторять");
    expect(doneText(3, new Date("2026-10-16T17:00:00Z"), "Europe/Moscow")).toContain("16.10, 20:00");
    // Пустой словарь — не «всё повторил»: новичку предлагаем набор, а не «появятся сами, жди».
    expect(doneText(0, undefined, "Europe/Moscow", true)).toContain("/sets");
    expect(doneText(0, undefined, "Europe/Moscow", true)).not.toContain("появятся сами");
    // Но если человек что-то повторил в этой сессии, правда всё-таки «готово».
    expect(doneText(3, undefined, "Europe/Moscow", true)).toContain("Повторено: 3");
    const text = statsText({ total: 3, learned: 1, learning: 1, fresh: 1, reviews7d: 2, streak: 2 }, "R", [
      { userId: 1, name: "Bob", learned: 1, reviews7d: 2 },
    ]);
    expect(text).toContain("Выучено: 1");
    expect(text).toContain("1. Bob");
  });
});

describe("DraftStore", () => {
  it("keeps one draft per user and finds the one awaiting an edit", () => {
    const store = new DraftStore();
    const base = { userId: 1, chatId: 10, roomId: 1, term: "a", translation: "", explanation: "", example: "" };
    const first = store.create(base);
    const second = store.create({ ...base, term: "b" });
    expect(store.get(first.id)).toBeUndefined();
    second.awaitingEdit = true;
    second.awaitingSince = Date.now();
    expect(store.findAwaiting(1, 10)?.term).toBe("b");
    expect(store.findAwaiting(1, 11)).toBeUndefined();
    store.delete(second.id);
    expect(store.get(second.id)).toBeUndefined();
  });
});
