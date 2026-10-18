import { describe, expect, it } from "vitest";
import { BatchStore } from "../src/bot/batches";
import { decodeCb, encodeCb, type Cb } from "../src/bot/callbacks";
import { batchKeyboard } from "../src/bot/keyboards";
import { batchSummaryText } from "../src/bot/texts";
import { buildExtractPrompt, MAX_EXTRACT, parseExtraction } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { filterNewItems, saveWord } from "../src/services/words";
import { T0, makeUser, testDb } from "./helpers";

const item = (term: string) => ({ term, translation: `t-${term}`, explanation: "", example: "", transcriptionUk: "", transcriptionUs: "", mnemonic: "", context: "" });

describe("parseExtraction", () => {
  it("parses a JSON array wrapped in chatter and a fence", () => {
    const json = JSON.stringify([item("serendipity"), item("take for granted")]);
    expect(parseExtraction("Вот:\n```json\n" + json + "\n```")).toEqual([item("serendipity"), item("take for granted")]);
  });

  it("caps the number of items", () => {
    const many = Array.from({ length: MAX_EXTRACT + 5 }, (_, i) => item(`w${i}`));
    expect(parseExtraction(JSON.stringify(many))).toHaveLength(MAX_EXTRACT);
  });

  it("throws on garbage and drops items without a term or translation", () => {
    expect(() => parseExtraction("ничего")).toThrow();
    expect(parseExtraction(JSON.stringify([item("ok"), { term: "", translation: "x" }, { term: "y", translation: "" }]))).toEqual([item("ok")]);
  });

  it("puts the text into the prompt", () => {
    expect(buildExtractPrompt("It was pure serendipity")).toContain("It was pure serendipity");
  });
});

describe("extraction limits", () => {
  it("allows 100 items and pages them to stay under Telegram's 100-button limit", () => {
    expect(MAX_EXTRACT).toBe(100);
    const store = new BatchStore();
    const batch = store.create({ userId: 1, chatId: 1, roomId: 1, items: Array.from({ length: MAX_EXTRACT }, (_, i) => item(`w${i}`)) });
    const labels = () => batchKeyboard(batch).inline_keyboard.flat().map((b) => b.text);
    expect(labels().length).toBeLessThanOrEqual(100);
    expect(labels()).toContain("1/4");
    expect(labels()).toContain("✅ Добавить (100)");
    batch.page = 3;
    batch.toggle(99);
    expect(labels().some((l) => l.startsWith("⬜️ w99"))).toBe(true);
    expect(labels()).toContain("✅ Добавить (99)");
  });

  it("tells the model to keep every item of a list", () => {
    expect(buildExtractPrompt("a\nb")).toMatch(/каждый пункт/);
  });
});

describe("filterNewItems", () => {
  it("drops words already in the room and repeats inside the batch", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: item("bank"), now: T0 });
    const fresh = await filterNewItems(db, room.id, [item("Bank"), item("serendipity"), item(" Serendipity "), item("hangar")]);
    expect(fresh.map((i) => i.term)).toEqual(["serendipity", "hangar"]);
  });
});

describe("batch callbacks", () => {
  it("round-trips", () => {
    const all: Cb[] = [
      { k: "batchToggle", id: 3, index: 12 },
      { k: "batch", id: 3, action: "add" },
      { k: "batch", id: 3, action: "review" },
      { k: "batch", id: 3, action: "cancel" },
      { k: "batchPage", id: 3, page: 2 },
      { k: "edit", wordId: 41 },
      { k: "roomRename", roomId: 2 },
      { k: "drillPick", qid: 17, index: 2 },
      { k: "duel", roundId: 9, index: 3 },
      { k: "cardPart", part: "mnemonic" },
      { k: "mistakesSave", id: 4, save: true },
      { k: "notifyDue" },
      { k: "redraw", wordId: 3 },
      { k: "redrawAs", wordId: 3, how: "again" },
      { k: "redrawAs", wordId: 3, how: "custom" },
      { k: "redrawAs", wordId: 3, how: 5 },
      { k: "practiceStart" },
      { k: "practiceStop" },
      { k: "practiceRate", cardId: 3, remembered: true },
      { k: "practiceDunno", cardId: 3 },
      { k: "rate", cardId: 9, reps: 2, answer: "good", stage: "ru_en" },
      { k: "mistakesSave", id: 4, save: false },
      { k: "roomDel", roomId: 2 },
      { k: "roomDelOk", roomId: 2 },
      { k: "audio", wordId: 41, accent: "uk" },
      { k: "audio", wordId: 41, accent: "us" },
      { k: "del", wordId: 41 },
      { k: "delOk", wordId: 41 },
      { k: "delCancel" },
      { k: "delBatch", id: 5 },
      { k: "delBatchOk", id: 5 },
      { k: "delPage", id: 5, page: 1 },
      { k: "draft", id: 7, action: "skip" },
      { k: "draft", id: 7, action: "stop" },
    ];
    for (const cb of all) expect(decodeCb(encodeCb(cb))).toEqual(cb);
  });
});

describe("BatchStore", () => {
  it("selects everything by default, toggles, and keeps one batch per user", () => {
    const store = new BatchStore();
    const first = store.create({ userId: 1, chatId: 10, roomId: 1, items: [item("a"), item("b")] });
    const second = store.create({ userId: 1, chatId: 10, roomId: 1, items: [item("a"), item("b"), item("c")] });
    expect(store.get(first.id)).toBeUndefined();
    expect(second.selectedItems().map((i) => i.term)).toEqual(["a", "b", "c"]);
    second.toggle(1);
    expect(second.selectedItems().map((i) => i.term)).toEqual(["a", "c"]);
  });
});

describe("batch texts and keyboard", () => {
  it("summarizes added words with escaping and a cap", () => {
    const words = Array.from({ length: 17 }, (_, i) => ({ term: i === 0 ? "R&D" : `w${i}` }));
    const text = batchSummaryText("Саша", words, "Друзья");
    expect(text).toContain("17 слов");
    expect(text).toContain("R&amp;D");
    expect(text).toContain("и ещё 2");
  });

  it("marks selection and shows the selected count", () => {
    const store = new BatchStore();
    const batch = store.create({ userId: 1, chatId: 10, roomId: 1, items: [item("a"), item("b")] });
    batch.toggle(0);
    const labels = batchKeyboard(batch).inline_keyboard.flat().map((b) => b.text);
    expect(labels[0]).toMatch(/^⬜️ a/);
    expect(labels[1]).toMatch(/^✅ b/);
    expect(labels).toContain("✅ Добавить (1)");
  });
});
