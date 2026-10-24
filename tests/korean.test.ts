import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { rooms, wordSets } from "../src/db/schema";
import { currentLang, withLang } from "../src/lang";
import type { Enrichment, WordEnricher } from "../src/llm/enricher";
import { ClozeGenerator } from "../src/services/cloze-generator";
import { createRoom, ensurePersonalRoom, personalRoom } from "../src/services/rooms";
import { nextDue } from "../src/services/review";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { replaceSet, listSets } from "../src/services/word-sets";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { at, DAY, makeUser, T0, testDb } from "./helpers";

/** Обогатитель, который запоминает, на каком языке его позвали. */
function recordingEnricher(answer: (term: string) => Enrichment) {
  const langs: string[] = [];
  const enricher: WordEnricher = {
    enrich: vi.fn(async (term: string) => {
      langs.push(currentLang().code);
      return answer(term);
    }),
    extract: async () => [],
    extractImage: async () => [],
    check: async () => ({ corrected: "", fixes: [], natural: "" }),
  };
  return { enricher, langs };
}

const texts = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

describe("🇰🇷 Korean", () => {
  it("/start offers the languages; 🇰🇷 creates «Мои слова 🇰🇷» and makes it current, English stays where it was", async () => {
    const h = botHarness();
    await h.bot.handleUpdate(h.message(100, "/start"));
    await vi.waitFor(() => expect(() => buttonData(h.calls, "🇰🇷 Корейский")).not.toThrow());
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🇰🇷 Корейский")));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Учим корейский"));
    const user = (await makeUser(h.db, 100))!;
    const ko = await personalRoom(h.db, user.id, "ko");
    expect(ko).toMatchObject({ name: "Мои слова 🇰🇷", language: "ko", legacyPersonalOf: null });
    expect((await personalRoom(h.db, user.id, "en"))?.legacyPersonalOf).toBe(user.id);
    expect(user.currentRoomId).toBe(ko!.id);
    // Повторно — не создаёт второй и не дёргает.
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🇰🇷 Корейский")));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Ты и так учишь корейский"));
  });

  it("a word sent in the Korean room is prepared in Korean: romanization, one audio button", async () => {
    const { enricher, langs } = recordingEnricher(() => ({ term: "사랑", translation: "любовь", explanation: "", example: "사랑해요.", transcriptionUk: "sa-rang", transcriptionUs: "" }));
    const h = botHarness({ enricher });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const ko = await ensurePersonalRoom(h.db, user.id, T0, "ko");
    await updateUser(h.db, user.id, { currentRoomId: ko.id });
    await h.bot.handleUpdate(h.message(100, "사랑을"));
    await vi.waitFor(() => expect(texts(h).some((t) => t.includes("<b>사랑</b>"))).toBe(true));
    expect(langs).toEqual(["ko"]);
    const card = texts(h).find((t) => t.includes("<b>사랑</b>"))!;
    expect(card).toContain("[sa-rang]");
    expect(card).not.toContain("🇬🇧");
  });

  it("an English user sees exactly the old flow — English prompts, UK/US", async () => {
    const { enricher, langs } = recordingEnricher(() => ({ translation: "берег", explanation: "", example: "", transcriptionUk: "bæŋk", transcriptionUs: "bæŋk" }));
    const h = botHarness({ enricher });
    await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "bank"));
    await vi.waitFor(() => expect(texts(h).some((t) => t.includes("<b>bank</b>"))).toBe(true));
    expect(langs).toEqual(["en"]);
    expect(texts(h).find((t) => t.includes("<b>bank</b>"))).toContain("🇬🇧🇺🇸 /bæŋk/");
  });

  it("simultaneous updates in different languages do not leak into each other", async () => {
    const seen: Record<string, string> = {};
    const enricher: WordEnricher = {
      enrich: async (term: string) => {
        // Разные задержки: запросы перемешиваются во времени.
        await new Promise((r) => setTimeout(r, term === "bank" ? 30 : 5));
        seen[term] = currentLang().code;
        return { translation: "x", explanation: "", example: "" };
      },
      extract: async () => [],
      extractImage: async () => [],
      check: async () => ({ corrected: "", fixes: [], natural: "" }),
    };
    const h = botHarness({ enricher });
    const en = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const kr = await updateUser(h.db, (await makeUser(h.db, 200)).id, { canDm: true });
    await ensurePersonalRoom(h.db, en.id, T0);
    await updateUser(h.db, kr.id, { currentRoomId: (await ensurePersonalRoom(h.db, kr.id, T0, "ko")).id });
    await Promise.all([h.bot.handleUpdate(h.message(100, "bank")), h.bot.handleUpdate(h.message(200, "사랑"))]);
    await vi.waitFor(() => expect(Object.keys(seen)).toHaveLength(2));
    expect(seen).toEqual({ bank: "en", 사랑: "ko" });
  });

  it("/learn shows the words of the current language only", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const en = await ensurePersonalRoom(db, user.id, T0);
    const ko = await ensurePersonalRoom(db, user.id, T0, "ko");
    await saveWord(db, { roomId: en.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
    await saveWord(db, { roomId: ko.id, addedBy: user.id, draft: { term: "사랑", translation: "любовь", explanation: "", example: "" }, now: T0 });
    const later = at(DAY);
    expect((await withLang("en", () => nextDue(db, user.id, later)))?.word.term).toBe("bank");
    expect((await withLang("ko", () => nextDue(db, user.id, later)))?.word.term).toBe("사랑");
  });

  it("/room offers «🇰🇷 Учить корейский» until there is a Korean room; a friends' room inherits the language", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/room"));
    await vi.waitFor(() => expect(lastButtons(h.calls).map((b) => b.text)).toContain("🇰🇷 Учить корейский"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "🇰🇷 Учить корейский")));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Учим корейский"));
    await h.bot.handleUpdate(h.message(100, "/newroom Друзья"));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Друзья"));
    const [friends] = await h.db.select().from(rooms).where(eq(rooms.name, "Друзья"));
    expect(friends.language).toBe("ko");
    await h.bot.handleUpdate(h.message(100, "/room"));
    await vi.waitFor(() => expect(texts(h).at(-1)).toContain("Друзья 🇰🇷"));
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🇰🇷 Учить корейский");
    expect(user.id).toBeGreaterThan(0);
  });

  it("word sets are listed by language; «learn» goes to the personal dictionary of the set's language", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    await replaceSet(db, { slug: "a1", title: "A1", kind: "level", description: "", position: 0 }, [], T0);
    await replaceSet(db, { slug: "topik1", title: "TOPIK 1", kind: "level", description: "", position: 0, language: "ko" }, [], T0);
    expect((await withLang("en", () => listSets(db, user.id))).map((s) => s.set.slug)).toEqual(["a1"]);
    expect((await withLang("ko", () => listSets(db, user.id))).map((s) => s.set.slug)).toEqual(["topik1"]);
    const [topik] = await db.select().from(wordSets).where(eq(wordSets.slug, "topik1"));
    expect(topik.language).toBe("ko");
  });

  it("background generators use the word's language, not the one they were started from", async () => {
    const db = testDb();
    const user = await makeUser(db, 100);
    const ko = await createRoom(db, { name: "K", createdBy: user.id, now: T0, language: "ko" });
    const saved = await saveWord(db, { roomId: ko.id, addedBy: user.id, draft: { term: "사랑", translation: "любовь", explanation: "", example: "" }, now: T0 });
    if (saved.status !== "saved") throw new Error("not saved");
    const langs: string[] = [];
    const tutor = { cloze: async () => (langs.push(currentLang().code), []) } as never;
    await withLang("en", () => new ClozeGenerator(db, tutor, () => T0).ensure(saved.word));
    expect(langs).toEqual(["ko"]);
  });
});
