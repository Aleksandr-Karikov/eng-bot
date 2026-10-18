import { describe, expect, it, vi } from "vitest";
import { cardText, draftText, reverseCardText } from "../src/bot/texts";
import { rateKeyboard, wordActionsKeyboard } from "../src/bot/keyboards";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const word = { term: "beset by", translation: "осаждаемый", explanation: "", example: "", mnemonic: "бесы осадили" };

describe("mnemonic as part of the word", () => {
  it("is shown in the description and under the spoiler on every card", () => {
    expect(draftText(word)).toContain("💡 бесы осадили");
    expect(cardText(word)).toMatch(/<tg-spoiler>[^]*💡 бесы осадили[^]*<\/tg-spoiler>/);
    expect(reverseCardText(word)).toMatch(/<tg-spoiler>[^]*💡 бесы осадили[^]*<\/tg-spoiler>/);
  });

  it("is saved with the word on /add", async () => {
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "осаждаемый", explanation: "", example: "" }),
        extractImage: async () => [], extract: async () => [],
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
      tutor: {
        cloze: async () => [],
        judge: async () => ({ correct: false, explanation: "", tip: "" }),
        drill: async () => [],
        mnemonics: async () => ["бесы осадили"],
        story: async () => ({ title: "", body: "", questions: [] }), untangle: async () => ({ why: "", contrast: [], examples: [], tip: "" }), reviewSentence: async () => ({ usesWord: true, verdict: "", corrected: "", fixes: [], natural: "" }), imagePrompt: async () => "",
      },
    });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/add beset by"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    expect(h.calls.some((c) => String(c.payload.text).includes("💡 бесы осадили"))).toBe(true);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await vi.waitFor(async () => expect((await getWord(h.db, 1))?.mnemonic).toBe("бесы осадили"));
  });

  it("replaces the 💡 button with 🖼 when pictures are on, and shows neither when they are off", () => {
    const labels = (kb: { inline_keyboard: Array<Array<{ text: string }>> }) => kb.inline_keyboard.flat().map((b) => b.text);
    expect(labels(rateKeyboard(1, 0, true, 5))).not.toContain("💡 Запоминалка");
    expect(labels(wordActionsKeyboard(5))).not.toContain("🖼 Картинка");
    expect(labels(wordActionsKeyboard(5, true))).toContain("🖼 Картинка");
  });
});
