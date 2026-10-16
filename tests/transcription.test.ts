import { describe, expect, it, vi } from "vitest";
import { cardText, draftText, transcriptionLine } from "../src/bot/texts";
import { buildExtractPrompt, buildPrompt, parseEnrichment, parseExtraction } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

describe("transcription from Claude", () => {
  it("parses UK and US transcriptions and defaults to empty", () => {
    const parsed = parseEnrichment(JSON.stringify({ translation: "берег", explanation: "", example: "", transcription_uk: "/bæŋk/", transcription_us: "/bæŋk/" }));
    expect(parsed).toMatchObject({ transcriptionUk: "/bæŋk/", transcriptionUs: "/bæŋk/" });
    expect(parseEnrichment(JSON.stringify({ translation: "берег" }))).toMatchObject({ transcriptionUk: "", transcriptionUs: "" });
    const [item] = parseExtraction(JSON.stringify([{ term: "tomato", translation: "помидор", transcription_uk: "/təˈmɑːtəʊ/", transcription_us: "/təˈmeɪtoʊ/" }]));
    expect(item).toMatchObject({ term: "tomato", transcriptionUk: "/təˈmɑːtəʊ/", transcriptionUs: "/təˈmeɪtoʊ/" });
  });

  it("asks for both transcriptions in the prompts", () => {
    for (const p of [buildPrompt("bank"), buildExtractPrompt("bank")]) {
      expect(p).toContain("transcription_uk");
      expect(p).toContain("transcription_us");
    }
  });
});

describe("transcription display", () => {
  it("shows both, merges identical ones and normalizes slashes", () => {
    expect(transcriptionLine({ transcriptionUk: "təˈmɑːtəʊ", transcriptionUs: "[təˈmeɪtoʊ]" })).toBe("🇬🇧 /təˈmɑːtəʊ/ · 🇺🇸 /təˈmeɪtoʊ/");
    expect(transcriptionLine({ transcriptionUk: "/bæŋk/", transcriptionUs: "/bæŋk/" })).toBe("🇬🇧🇺🇸 /bæŋk/");
    expect(transcriptionLine({ transcriptionUk: "", transcriptionUs: "/bæŋk/" })).toBe("🇺🇸 /bæŋk/");
    expect(transcriptionLine({})).toBe("");
  });

  it("puts the transcription in the draft and visibly on the card front", () => {
    const word = { term: "bank", translation: "берег", explanation: "", example: "", transcriptionUk: "/bæŋk/", transcriptionUs: "/bæŋk/" };
    expect(draftText(word)).toBe("<b>bank</b> — берег\n🇬🇧🇺🇸 /bæŋk/");
    expect(cardText(word)).toMatch(/^<b>bank<\/b>\n🇬🇧🇺🇸 \/bæŋk\/\n\n<tg-spoiler>/);
  });
});

describe("transcription storage", () => {
  it("saves and updates transcriptions", async () => {
    const db = testDb();
    const alice = await makeUser(db, 1);
    const room = await createRoom(db, { name: "R", createdBy: alice.id, now: T0 });
    const res = await saveWord(db, { roomId: room.id, addedBy: alice.id, draft: { term: "bank", translation: "берег", explanation: "", example: "", transcriptionUk: "/bæŋk/" }, now: T0 });
    if (res.status !== "saved") throw new Error("dup");
    expect(res.word).toMatchObject({ transcriptionUk: "/bæŋk/", transcriptionUs: "" });
    await updateWord(db, res.word.id, { translation: "банк", explanation: "", example: "", transcriptionUs: "/bæŋk/" });
    expect(await getWord(db, res.word.id)).toMatchObject({ transcriptionUk: "/bæŋk/", transcriptionUs: "/bæŋk/" });
  });

  it("/add puts Claude's transcription into the preview and the saved word", async () => {
    const h = botHarness({
      enricher: {
        enrich: async () => ({ translation: "берег", explanation: "", example: "", transcriptionUk: "/bæŋk/", transcriptionUs: "/bæŋk/" }),
        extract: async () => [],
        check: async () => ({ corrected: "", fixes: [], natural: "" }),
      },
    });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/add bank"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "✅ Ок")).not.toThrow());
    expect(h.calls.some((c) => String(c.payload.text).includes("🇬🇧🇺🇸 /bæŋk/"))).toBe(true);
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ Ок")));
    await vi.waitFor(async () => expect(await getWord(h.db, 1)).toMatchObject({ transcriptionUk: "/bæŋk/" }));
  });
});
