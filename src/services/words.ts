import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { newCard } from "../srs/srs";
import { cards, clozeSentences, reviewLogs, rooms, words, type User, type Word, wordUses } from "../db/schema";
import { parseExampleTranslation, type WordEnricher } from "../llm/enricher";
import { getRoom, listMembers } from "./rooms";
import { removeReviewHistory } from "./combat-ledger";

export interface WordDraft {
  term: string;
  translation: string;
  explanation: string;
  example: string;
  transcriptionUk?: string;
  transcriptionUs?: string;
  mnemonic?: string;
  /** Где встретилось — исходное предложение. */
  context?: string;
  /** 3 — очень полезное, 2 — полезное, 1 — необязательное; null/undefined — не оценено. */
  usefulness?: number | null;
  usefulnessNote?: string;
}

/** Длиннее — это уже не предложение, а абзац: на карточке только мешает. */
export const MAX_CONTEXT = 300;

/**
 * Предел длины самого слова (или фразы). 120 символов — это уже длинная идиома, а не слово.
 *
 * Ограничение живёт здесь, в единственной точке сохранения, потому что раньше его не было ни в `/add`,
 * ни в `prepareWord`, ни в `saveWord` — только в расширении и Mini App. Слово в 1100 символов проходило
 * в базу и создавало карточки всем участникам комнаты; на таком слове вешался `/learnnew`
 * (в виджете `while` урезал только перевод, а `term` не трогал — цикл не завершался никогда), да и
 * карточка в чате рисковала не влезть в лимит Telegram.
 */
export const MAX_TERM = 120;

/** Только поля слова — без служебных полей черновика/пачки. */
export function toWordDraft(d: WordDraft): WordDraft {
  return {
    term: d.term,
    translation: d.translation,
    explanation: d.explanation,
    example: d.example,
    transcriptionUk: d.transcriptionUk ?? "",
    transcriptionUs: d.transcriptionUs ?? "",
    mnemonic: d.mnemonic ?? "",
    context: d.context ?? "",
    usefulness: d.usefulness,
    usefulnessNote: d.usefulnessNote ?? "",
  };
}

export function normalizeTerm(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, " ");
}

/** "bank — берег" / "bank - берег" / "bank". Дефис без пробелов вокруг (well-known) — часть слова. */
export function parseAddInput(text: string): { term: string; translation?: string } | null {
  const trimmed = text.trim();
  if (!trimmed || /^[—–-]/.test(trimmed)) return null;
  const m = /^(.+?)\s+[—–-]\s+(.+)$/s.exec(trimmed);
  if (!m) return { term: trimmed };
  return { term: m[1].trim(), translation: m[2].trim() };
}

export async function findWord(db: Db, roomId: number, term: string): Promise<Word | undefined> {
  const [word] = await db
    .select()
    .from(words)
    .where(and(eq(words.roomId, roomId), eq(words.termNormalized, normalizeTerm(term))));
  return word;
}

export async function getWord(db: Db, id: number): Promise<Word | undefined> {
  const [word] = await db.select().from(words).where(eq(words.id, id));
  return word;
}

export async function saveWord(
  db: Db,
  input: { roomId: number; addedBy: number; draft: WordDraft; now: Date },
): Promise<{ status: "duplicate" } | { status: "no-room" } | { status: "too-long"; limit: number } | { status: "saved"; word: Word; members: User[] }> {
  // Черновик мог пережить удаление комнаты.
  if (!(await getRoom(db, input.roomId))) return { status: "no-room" };
  // Длину проверяем здесь, а не у вызывающих: путей сохранения несколько (бот, приложение, расширение,
  // наборы), и забыть проверку в одном из них слишком легко.
  if (input.draft.term.trim().length > MAX_TERM) return { status: "too-long", limit: MAX_TERM };
  if (await findWord(db, input.roomId, input.draft.term)) return { status: "duplicate" };
  const members = await listMembers(db, input.roomId);
  // Слово и карточки — одно состояние. Раньше `INSERT words` и `createCards` шли порознь: падение
  // между ними оставляло слово, невидимое участникам навсегда — оно есть в словаре комнаты, но ни у
  // кого нет карточки, и в `/learn` оно не появится никогда (E28).
  //
  // Транзакция синхронная и намеренно: `better-sqlite3` не умеет ждать `async`-колбэк и коммитит
  // то, что успело выполниться (проверено пробой — см. `saveAnswer`). Поэтому карточки вставляются
  // здесь же, синхронно, а не через `createCards`, которая асинхронная.
  // Вставка слова и карточек — ВНУТРИ одной транзакции: раньше слово вставлялось до неё, и падение
  // на карточках оставляло слово без карточек навсегда (проверено тестом: слово оставалось в базе).
  const created = db.transaction((tx) => {
    const inserted = tx
      .insert(words)
      .values({
        roomId: input.roomId,
        addedBy: input.addedBy,
        term: input.draft.term.trim(),
        termNormalized: normalizeTerm(input.draft.term),
        translation: input.draft.translation,
        explanation: input.draft.explanation,
        example: input.draft.example,
        transcriptionUk: input.draft.transcriptionUk ?? "",
        transcriptionUs: input.draft.transcriptionUs ?? "",
        mnemonic: input.draft.mnemonic ?? "",
        context: (input.draft.context ?? "").trim().slice(0, MAX_CONTEXT),
        usefulness: input.draft.usefulness ?? null,
        usefulnessNote: input.draft.usefulnessNote ?? "",
        createdAt: input.now,
      })
      // Два почти одновременных добавления (двойной клик в расширении): второе — дубликат, а не ошибка.
      .onConflictDoNothing()
      .returning()
      .all();
    const word = inserted[0];
    if (!word) return undefined;
    const rows = members.map((m) => ({ userId: m.id, wordId: word.id, createdAt: input.now, ...newCard(input.now) }));
    for (let i = 0; i < rows.length; i += 200) {
      tx.insert(cards).values(rows.slice(i, i + 200)).onConflictDoNothing().run();
    }
    return word;
  });
  if (!created) return { status: "duplicate" };
  return { status: "saved", word: created, members };
}

/**
 * Копирует слово в другую комнату — для кнопки «➕ В мой словарь» под инлайн-карточкой.
 *
 * Модель здесь не зовётся: слово уже переведено и объяснено, копируем готовое. Это и есть причина,
 * по которой инлайн отвечает мгновенно, а добавление из него не стоит ничего.
 */
export async function copyWord(
  db: Db,
  input: { word: Word; toRoomId: number; addedBy: number; now: Date },
): Promise<{ status: "duplicate" } | { status: "saved"; word: Word }> {
  if (await findWord(db, input.toRoomId, input.word.term)) return { status: "duplicate" };
  const saved = await saveWord(db, {
    roomId: input.toRoomId,
    addedBy: input.addedBy,
    now: input.now,
    draft: {
      term: input.word.term,
      translation: input.word.translation,
      explanation: input.word.explanation,
      example: input.word.example,
      transcriptionUk: input.word.transcriptionUk,
      transcriptionUs: input.word.transcriptionUs,
      mnemonic: input.word.mnemonic,
      context: input.word.context,
      usefulness: input.word.usefulness ?? undefined,
      usefulnessNote: input.word.usefulnessNote,
    },
  });
  return saved.status === "saved" ? { status: "saved", word: saved.word } : { status: "duplicate" };
}

/** Убирает слова, которые уже есть в комнате, и повторы внутри самой пачки (с учётом регистра и пробелов). */
export async function filterNewItems<T extends { term: string }>(db: Db, roomId: number, items: T[]): Promise<T[]> {
  const existing = await db.select({ term: words.termNormalized }).from(words).where(eq(words.roomId, roomId));
  const seen = new Set(existing.map((w) => w.term));
  const fresh: T[] = [];
  for (const item of items) {
    const key = normalizeTerm(item.term);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push({ ...item, term: item.term.trim() });
  }
  return fresh;
}

/** Слова комнаты, новые сверху; fragment — подстрока без учёта регистра и лишних пробелов. */
export async function listRoomWords(db: Db, roomId: number, fragment?: string): Promise<Word[]> {
  const all = await db.select().from(words).where(eq(words.roomId, roomId)).orderBy(desc(words.createdAt), desc(words.id));
  const needle = fragment ? normalizeTerm(fragment) : "";
  return needle ? all.filter((w) => w.termNormalized.includes(needle)) : all;
}

/** Удаляет слово у всех: историю повторений, карточки и само слово. Возвращает удалённое или undefined. */
export async function deleteWord(db: Db, wordId: number): Promise<Word | undefined> {
  const word = await getWord(db, wordId);
  if (!word) return undefined;
  const cardIds = (await db.select({ id: cards.id }).from(cards).where(eq(cards.wordId, wordId))).map((c) => c.id);
  // Сначала все ссылки на слово (foreign_keys = ON): иначе удаление упадёт посередине и слово останется без карточек.
  if (cardIds.length) await removeReviewHistory(db, inArray(reviewLogs.cardId, cardIds));
  await db.delete(clozeSentences).where(eq(clozeSentences.wordId, wordId));
  await db.delete(wordUses).where(eq(wordUses.wordId, wordId));
  await db.delete(cards).where(eq(cards.wordId, wordId));
  await db.delete(words).where(eq(words.id, wordId));
  return word;
}

/**
 * Исправляет слово, не трогая карточки (прогресс у всех сохраняется).
 * Если term меняется и совпадает с другим словом комнаты — duplicate.
 */
export async function updateWord(
  db: Db,
  wordId: number,
  patch: {
    term?: string;
    translation: string;
    explanation: string;
    example: string;
    /** undefined — оставить как есть. */
    transcriptionUk?: string;
    transcriptionUs?: string;
    /** undefined — оставить, а при смене значения — сбросить. */
    mnemonic?: string;
    /** undefined — оставить как есть. */
    usefulness?: number;
    usefulnessNote?: string;
    collocations?: string;
    leechHelp?: string;
  },
  expected?: Word,
): Promise<{ status: "duplicate" } | { status: "missing" } | { status: "stale" } | { status: "updated"; word: Word }> {
  const word = await getWord(db, wordId);
  if (!word) return { status: "missing" };
  const term = patch.term?.trim() || word.term;
  const termNormalized = normalizeTerm(term);
  if (termNormalized !== word.termNormalized) {
    const clash = await findWord(db, word.roomId, term);
    if (clash && clash.id !== word.id) return { status: "duplicate" };
  }
  // Предложения с пропуском писались под старое слово/значение — пересоздадутся позже.
  const meaningChanged = termNormalized !== word.termNormalized || patch.translation.trim() !== word.translation.trim();

  const [updated] = await db
    .update(words)
    .set({
      term,
      termNormalized,
      translation: patch.translation,
      explanation: patch.explanation,
      example: patch.example,
      transcriptionUk: patch.transcriptionUk ?? word.transcriptionUk,
      transcriptionUs: patch.transcriptionUs ?? word.transcriptionUs,
      ...(patch.usefulness !== undefined ? { usefulness: patch.usefulness, usefulnessNote: patch.usefulnessNote ?? "" } : {}),
      // Озвучка относится к самому слову — при его изменении записывается заново.
      ...(termNormalized !== word.termNormalized ? { audioUkFileId: null, audioUsFileId: null } : {}),
      // Запоминалка писалась под старое значение.
      ...(meaningChanged ? { mnemonic: "", imageFileId: null, leechHelp: "", collocations: "" } : {}),
      // Перевод примера — перевод прежнего предложения: поменяли пример — переведём заново.
      ...(patch.example.trim() !== word.example.trim() ? { exampleTranslation: "" } : {}),
      // Формы, родня, часть речи и уровень относятся к самому слову: при его смене готовятся заново.
      ...(termNormalized !== word.termNormalized ? { partOfSpeech: "", cefr: "", forms: "[]", synonyms: "[]", antonyms: "[]" } : {}),
      ...(patch.mnemonic !== undefined ? { mnemonic: patch.mnemonic } : {}),
      ...(patch.collocations !== undefined ? { collocations: patch.collocations } : {}),
      ...(patch.leechHelp !== undefined ? { leechHelp: patch.leechHelp } : {}),
    })
    .where(and(eq(words.id, wordId), ...(expected ? [
      eq(words.roomId, expected.roomId), eq(words.term, expected.term), eq(words.translation, expected.translation), eq(words.explanation, expected.explanation),
      eq(words.example, expected.example), eq(words.transcriptionUk, expected.transcriptionUk), eq(words.transcriptionUs, expected.transcriptionUs),
      eq(words.mnemonic, expected.mnemonic), eq(words.collocations, expected.collocations), eq(words.leechHelp, expected.leechHelp),
      eq(words.context, expected.context), eq(words.moreContexts, expected.moreContexts),
    ] : [])))
    .returning();
  if (!updated) return { status: expected ? "stale" : "missing" };
  if (meaningChanged) await db.delete(clozeSentences).where(eq(clozeSentences.wordId, wordId));
  return { status: "updated", word: updated };
}

export async function setAudioFileId(db: Db, wordId: number, accent: "uk" | "us", fileId: string): Promise<void> {
  await db.update(words).set(accent === "uk" ? { audioUkFileId: fileId } : { audioUsFileId: fileId }).where(eq(words.id, wordId));
}

export async function setUsefulness(db: Db, wordId: number, usefulness: number, note: string): Promise<void> {
  await db.update(words).set({ usefulness, usefulnessNote: note }).where(eq(words.id, wordId));
}

export async function setLeechHelp(db: Db, wordId: number, help: string): Promise<void> {
  await db.update(words).set({ leechHelp: help }).where(eq(words.id, wordId));
}

export async function setMnemonic(db: Db, wordId: number, mnemonic: string): Promise<void> {
  await db.update(words).set({ mnemonic }).where(eq(words.id, wordId));
}

export async function setImageFileId(db: Db, wordId: number, fileId: string): Promise<void> {
  await db.update(words).set({ imageFileId: fileId }).where(eq(words.id, wordId));
}

/**
 * Перевод примера для карточки: готовый — из базы, иначе один запрос к модели и сохранение.
 * Слово общее для комнаты, поэтому и перевод общий: второй человек получает его мгновенно.
 */
export async function exampleTranslation(db: Db, enricher: WordEnricher, word: Pick<Word, "id" | "term" | "example" | "exampleTranslation">): Promise<string> {
  // Разбор и у сохранённого: в первые тапы в базу легла сырая JSON-обёртка ответа модели.
  if (word.exampleTranslation || !word.example) return parseExampleTranslation(word.exampleTranslation);
  const translate = enricher.translateExample;
  if (!translate) return "";
  const translation = await translate.call(enricher, word.example, word.term);
  // Пока модель думала, пример могли поменять — тогда перевод уже не к нему.
  await db.update(words).set({ exampleTranslation: translation }).where(and(eq(words.id, word.id), eq(words.example, word.example), eq(words.exampleTranslation, "")));
  return translation;
}
