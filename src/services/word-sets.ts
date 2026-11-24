import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, rooms, setDecisions, setItems, users, wordSets, words, type SetItem, type User, type WordSet } from "../db/schema";
import { ensurePersonalRoom, isMember, listUserRooms } from "./rooms";
import { deleteWord, findWord, getWord, normalizeTerm, saveWord } from "./words";

/**
 * 📦 Готовые наборы слов. Человек разбирает набор колодой: знаю / учу / не для меня.
 *
 * «Учу» кладёт слово в комнату из `users.setTargetRoomId` — человек выбирает её один раз, при первом
 * разборе. По умолчанию это личный словарь «Мои слова»: туда же он шёл всегда, и друзей не засыпает
 * «знаешь?». Но если слова учат в общей комнате, они должны попадать именно туда — иначе урон боссу
 * считается цели личной комнаты, где человек один, и слова будто «не засчитываются».
 */
export type SetDecision = "learn" | "know" | "drop";

/** Куда «учу» положит слово: комната и её имя для подписи. */
export interface SetTarget {
  roomId: number;
  roomName: string;
  /** Личная комната этого человека — значит, поведение по умолчанию, спрашивать не о чем. */
  personal: boolean;
}

export interface SetSummary {
  set: WordSet;
  total: number;
  /** Сколько слов уже разобрано (или уже было в словаре). */
  done: number;
}

/** Слова, которые человек уже учит (в любой своей комнате): в наборах их не показываем. */
async function knownTerms(db: Db, userId: number): Promise<Set<string>> {
  const rows = await db.select({ term: words.termNormalized }).from(cards).innerJoin(words, eq(cards.wordId, words.id)).where(eq(cards.userId, userId));
  return new Set(rows.map((r) => r.term));
}

/** Комнаты, в которые человек может складывать слова набора: только членские. */
export async function setTargetChoices(db: Db, user: User): Promise<Array<{ roomId: number; roomName: string; personal: boolean }>> {
  const mine = await listUserRooms(db, user.id);
  return mine
    // Личная комната — всегда последней: она запасной вариант, а не то, что человек ищет.
    .sort((a, b) => Number(a.personalOf != null) - Number(b.personalOf != null))
    .map((r) => ({ roomId: r.id, roomName: r.name, personal: r.personalOf === user.id }));
}

/**
 * Куда сейчас идут слова из наборов. Разрешено в этом порядке:
 * выбор человека (если он всё ещё в той комнате и язык тот же) → текущая комната этого языка →
 * личный словарь. Никогда не падает: набор должен работать всегда.
 */
export async function setTarget(db: Db, user: User, lang: string, now: Date): Promise<SetTarget> {
  const choices = await setTargetChoices(db, user);
  const chosen = choices.find((c) => c.roomId === user.setTargetRoomId);
  if (chosen) return chosen;
  const current = choices.find((c) => c.roomId === user.currentRoomId);
  if (current) return current;
  const first = choices[0];
  if (first) return first;
  const personal = await ensurePersonalRoom(db, user.id, now);
  return { roomId: personal.id, roomName: personal.name, personal: true };
}

/** Запомнить выбор: сюда пойдут слова этого языка. Общую комнату выбирает только её участник. */
export async function setSetTarget(db: Db, user: User, roomId: number): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await isMember(db, roomId, user.id))) return { ok: false, error: "Ты не в этой комнате" };
  const [room] = await db.select().from(rooms).where(eq(rooms.id, roomId));
  if (!room) return { ok: false, error: "Комнаты нет" };
  await db.update(users).set({ setTargetRoomId: roomId }).where(eq(users.id, user.id));
  return { ok: true };
}

async function decided(db: Db, userId: number): Promise<Set<number>> {
  const rows = await db.select({ itemId: setDecisions.itemId }).from(setDecisions).where(eq(setDecisions.userId, userId));
  return new Set(rows.map((r) => r.itemId));
}

export async function listSets(db: Db, userId: number): Promise<SetSummary[]> {
  // Наборы — на языке текущей комнаты.
  const sets = await db.select().from(wordSets).orderBy(asc(wordSets.position), asc(wordSets.id));
  const items = await db.select({ id: setItems.id, setId: setItems.setId, term: setItems.term }).from(setItems);
  const [mine, done] = await Promise.all([knownTerms(db, userId), decided(db, userId)]);
  return sets.map((set) => {
    const own = items.filter((i) => i.setId === set.id);
    return { set, total: own.length, done: own.filter((i) => done.has(i.id) || mine.has(normalizeTerm(i.term))).length };
  });
}

/**
 * Первый набор для новичка: A1 на языке текущей комнаты.
 *
 * Нужен ровно в одном месте — пустой `/learn`, где человеку нечего учить и его надо чем-то занять.
 * Уровень не спрашиваем: на входе человек не знает, A1 у него или B1, а лишний экран выбора
 * отпугивает новичка сильнее пустоты. Ошибка в сторону A1 безопаснее: знакомое он отбросит свайпом
 * «знаю» за пару минут, а незнакомое из B1 придётся догонять.
 */
export async function starterSet(db: Db): Promise<SetSummary | undefined> {
  const [a1] = await db.select().from(wordSets).where(eq(wordSets.slug, "a1"));
  if (!a1) return undefined;
  const items = await db.select({ id: setItems.id }).from(setItems).where(eq(setItems.setId, a1.id));
  return { set: a1, total: items.length, done: 0 };
}

/** Следующие неразобранные слова набора, по порядку; уже знакомые по словарю — пропускаем. */
export async function nextSetItems(db: Db, userId: number, setId: number, limit = 50): Promise<SetItem[]> {
  const items = await db.select().from(setItems).where(eq(setItems.setId, setId)).orderBy(asc(setItems.position), asc(setItems.id));
  const [mine, done] = await Promise.all([knownTerms(db, userId), decided(db, userId)]);
  return items.filter((i) => !done.has(i.id) && !mine.has(normalizeTerm(i.term))).slice(0, limit);
}

/**
 * Решение по слову. «Учу» — в комнату из выбора человека (`setTarget`). false — слова нет или по нему
 * уже решили.
 *
 * `target` передают, когда решение принимается по конкретному экрану (приложение уже знает, куда
 * человек складывает слова). Без него комната вычисляется по настройке — на случай фоновых вызовов.
 */
export async function decide(
  db: Db,
  input: { user: User; itemId: number; decision: SetDecision; now: Date; target?: SetTarget },
): Promise<boolean> {
  const [item] = await db.select().from(setItems).where(eq(setItems.id, input.itemId));
  if (!item) return false;
  const [already] = await db.select().from(setDecisions).where(and(eq(setDecisions.userId, input.user.id), eq(setDecisions.itemId, item.id)));
  if (already) return false;
  let wordId: number | null = null;
  if (input.decision === "learn") {
    const target = input.target ?? await setTarget(db, input.user, "en", input.now);
    const saved = await saveWord(db, {
      roomId: target.roomId,
      addedBy: input.user.id,
      draft: {
        term: item.term,
        translation: item.translation,
        explanation: item.explanation,
        example: item.example,
        transcriptionUk: item.transcriptionUk,
        transcriptionUs: item.transcriptionUs,
        usefulness: item.usefulness,
        usefulnessNote: item.usefulnessNote,
      },
      now: input.now,
    });
    wordId = saved.status === "saved" ? saved.word.id : ((await findWord(db, target.roomId, item.term))?.id ?? null);
  }
  await db.insert(setDecisions).values({ userId: input.user.id, itemId: item.id, decision: input.decision, wordId, decidedAt: input.now });
  return true;
}

/** ↩️ Отменить решение: слово снова в наборе; добавленное по «учу» — убирается из личного словаря. */
export async function undoDecision(db: Db, input: { userId: number; itemId: number }): Promise<boolean> {
  const [row] = await db.select().from(setDecisions).where(and(eq(setDecisions.userId, input.userId), eq(setDecisions.itemId, input.itemId)));
  if (!row) return false;
  await db.delete(setDecisions).where(and(eq(setDecisions.userId, input.userId), eq(setDecisions.itemId, input.itemId)));
  if (row.decision === "learn" && row.wordId != null) {
    const word = await getWord(db, row.wordId);
    // Только своё и только только что добавленное этим решением — чужие слова не трогаем.
    if (word && word.addedBy === input.userId) await deleteWord(db, word.id);
  }
  return true;
}

/** Заменить содержимое набора (скрипт сборки наборов). Решения людей по старым словам удаляются вместе с ними. */
export async function replaceSet(
  db: Db,
  set: { slug: string; title: string; kind: "level" | "topic"; description: string; position: number; language?: "en" },
  items: Array<Omit<SetItem, "id" | "setId" | "position">>,
  now: Date,
): Promise<number> {
  let [existing] = await db.select().from(wordSets).where(eq(wordSets.slug, set.slug));
  if (existing) {
    await db.update(wordSets).set({ title: set.title, kind: set.kind, description: set.description, position: set.position }).where(eq(wordSets.id, existing.id));
    const old = (await db.select({ id: setItems.id }).from(setItems).where(eq(setItems.setId, existing.id))).map((i) => i.id);
    if (old.length) await db.delete(setDecisions).where(inArray(setDecisions.itemId, old));
    await db.delete(setItems).where(eq(setItems.setId, existing.id));
  } else {
    [existing] = await db.insert(wordSets).values({ ...set, createdAt: now }).returning();
  }
  const seen = new Set<string>();
  const unique = items.filter((i) => {
    const key = normalizeTerm(i.term);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length) await db.insert(setItems).values(unique.map((i, position) => ({ ...i, setId: existing.id, position })));
  return unique.length;
}
