import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { cardText, draftText, formsLine, grammarLine, kinLine } from "../src/bot/texts";
import { words } from "../src/db/schema";
import { buildGrammarPrompt, parseGrammar, type ExerciseTutor, type WordGrammar } from "../src/llm/tutor";
import { GrammarGenerator } from "../src/services/grammar";
import { createRoom } from "../src/services/rooms";
import { getWord, saveWord, updateWord } from "../src/services/words";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser, testDb } from "./helpers";

const grammar: WordGrammar = {
  partOfSpeech: "существительное",
  cefr: "B1",
  forms: [{ form: "varieties", label: "множественное число" }],
  synonyms: [
    { term: "diversity", translation: "разнообразие" },
    { term: "assortment", translation: "ассортимент" },
  ],
  antonyms: [{ term: "uniformity", translation: "однородность" }],
};

async function setup() {
  const h = botHarness();
  const user = await makeUser(h.db, 100);
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  const saved = await saveWord(h.db, {
    roomId: room.id, addedBy: user.id, now: T0,
    draft: { term: "variety", translation: "разнообразие, сорт", explanation: "Используется с предлогом of.", example: "There is a wide variety of shops." },
  });
  if (saved.status !== "saved") throw new Error("fixture");
  return { h, user, word: saved.word };
}

describe("грамматика слова: часть речи, уровень, формы, синонимы и антонимы", () => {
  it("parses the model answer and normalises part of speech and level", () => {
    expect(parseGrammar(JSON.stringify({ part_of_speech: "noun", cefr: "b1", forms: [{ form: "varieties", label: "множественное число" }], synonyms: [{ term: "diversity", translation: "разнообразие" }], antonyms: [] })))
      .toMatchObject({ partOfSpeech: "существительное", cefr: "B1", antonyms: [] });
    // Неизвестная часть речи остаётся как пришла, неверный уровень отбрасывается.
    expect(parseGrammar(JSON.stringify({ part_of_speech: "деепричастие", cefr: "X1" })))
      .toMatchObject({ partOfSpeech: "деепричастие", cefr: "" });
    expect(parseGrammar(JSON.stringify({ part_of_speech: "noun", forms: [], synonyms: [], antonyms: [] })))
      .toMatchObject({ forms: [] });
  });

  it("fills the empty card once and does not ask the model again", async () => {
    const { h, word } = await setup();
    expect(await getWord(h.db, word.id)).toMatchObject({ partOfSpeech: "", cefr: "", forms: "[]", synonyms: "[]", antonyms: "[]" });

    const tutor = { ...h.deps.tutor, grammar: vi.fn(async () => grammar) };
    const gen = new GrammarGenerator(h.db, tutor);
    await gen.ensure(word);

    expect(await getWord(h.db, word.id)).toMatchObject({
      partOfSpeech: "существительное", cefr: "B1",
      forms: JSON.stringify(grammar.forms), synonyms: JSON.stringify(grammar.synonyms), antonyms: JSON.stringify(grammar.antonyms),
    });
    // Второй показ уже ничего не спрашивает.
    await gen.ensure((await getWord(h.db, word.id))!);
    expect(tutor.grammar).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite a word that was renamed while the model was thinking", async () => {
    const { h, word } = await setup();
    const tutor = {
      ...h.deps.tutor,
      grammar: vi.fn(async () => {
        // Пока модель думала, слово переименовали — её ответ уже не к нему.
        await h.db.update(words).set({ term: "choice", translation: "выбор" }).where(eq(words.id, word.id));
        return grammar;
      }),
    };
    await new GrammarGenerator(h.db, tutor).ensure(word);
    expect(await getWord(h.db, word.id)).toMatchObject({ partOfSpeech: "", forms: "[]" });
  });

  it("retries later when the model fails, without breaking the card", async () => {
    const { h, word } = await setup();
    const failing = { ...h.deps.tutor, grammar: vi.fn(async () => { throw new Error("offline"); }) };
    const gen = new GrammarGenerator(h.db, failing);
    await expect(gen.ensure(word)).resolves.toBeUndefined();
    await gen.ensure(word);
    expect(failing.grammar).toHaveBeenCalledTimes(1);
  });

  it("keeps the card readable when the stored JSON is broken", () => {
    const d = { term: "variety", translation: "разнообразие", explanation: "", example: "" };
    expect(formsLine("{oops")).toBe("");
    expect(kinLine("Синонимы", "not-json")).toBe("");
    expect(cardText({ ...d, forms: "[]", synonyms: "[]", antonyms: "[]" })).toContain("variety");
  });

  it("shows part of speech and level openly but keeps forms and relatives under the spoiler", () => {
    const word = { term: "variety", translation: "разнообразие", explanation: "смысл", example: "", partOfSpeech: "существительное", cefr: "B1", ...{ forms: JSON.stringify(grammar.forms), synonyms: JSON.stringify(grammar.synonyms), antonyms: JSON.stringify(grammar.antonyms) } };
    expect(grammarLine(word)).toBe("существительное · B1");
    const text = cardText(word);
    const [open] = text.split("<tg-spoiler>");
    // Часть речи и уровень — не подсказка к переводу, их видно сразу.
    expect(open).toContain("существительное · B1");
    // Родня и формы подсказывают смысл — только после тапа.
    expect(open).not.toContain("diversity");
    expect(open).not.toContain("varieties");
    expect(text).toContain("diversity — разнообразие");
    expect(text).toContain("uniformity — однородность");
  });

  it("adds the new fields to the draft card shown for approval", () => {
    const d = { term: "variety", translation: "разнообразие", explanation: "", example: "" };
    const text = draftText({ ...d, partOfSpeech: "существительное", cefr: "B1", forms: JSON.stringify(grammar.forms), synonyms: JSON.stringify(grammar.synonyms), antonyms: JSON.stringify(grammar.antonyms) });
    expect(text).toContain("существительное · B1");
    expect(text).toContain("Формы:");
    expect(text).toContain("varieties — множественное число");
    expect(text).toContain("Синонимы:");
  });

  it("asks for the word's own grammar, not for a dictionary form change", () => {
    const prompt = buildGrammarPrompt("varieties", "разнообразие, сорт");
    expect(prompt).toContain("varieties");
    expect(prompt).toContain("часть речи по-русски");
    expect(prompt).toContain("A1");
    expect(prompt).toContain("антонима нет");
  });

  // Формы и родня привязаны к самому слову: у нового слова они уже неверны.
  it("drops forms and relatives when the word itself is renamed", async () => {
    const { h, word } = await setup();
    await h.db.update(words).set({
      partOfSpeech: "существительное", cefr: "B1",
      forms: JSON.stringify(grammar.forms), synonyms: JSON.stringify(grammar.synonyms), antonyms: JSON.stringify(grammar.antonyms),
    }).where(eq(words.id, word.id));
    const before = (await getWord(h.db, word.id))!;
    await updateWord(h.db, word.id, { term: "choice", translation: "выбор", explanation: "", example: "" }, before);
    expect(await getWord(h.db, word.id)).toMatchObject({ term: "choice", partOfSpeech: "", cefr: "", forms: "[]", synonyms: "[]", antonyms: "[]" });
  });

  it("keeps them when only the explanation changes", async () => {
    const { h, word } = await setup();
    await h.db.update(words).set({ partOfSpeech: "существительное", cefr: "B1", forms: JSON.stringify(grammar.forms) }).where(eq(words.id, word.id));
    await updateWord(h.db, word.id, { translation: word.translation, explanation: "новое пояснение", example: word.example });
    expect(await getWord(h.db, word.id)).toMatchObject({ partOfSpeech: "существительное", cefr: "B1", forms: JSON.stringify(grammar.forms) });
  });
});
