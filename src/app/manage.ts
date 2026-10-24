import { and, eq, inArray } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import { CARD_PART_LABELS, MODE_LABELS } from "../bot/keyboards";
import { cards, reviewLogs, type User, type Word } from "../db/schema";
import { CARD_PARTS, cardView, toggleCardPart, type CardPart } from "../services/card-view";
import { dropCard, restoreCard } from "../services/cards";
import { storedCollocations } from "../services/collocations";
import { HARD_AFTER_LAPSES } from "../services/hard-words";
import { getRoom, isMember, listUserRooms } from "../services/rooms";
import { isLearned } from "../services/stats";
import { updateUser, type UserPatch } from "../services/users";
import { deleteWord, getWord, listRoomWords, parseAddInput, saveWord, setMnemonic, setUsefulness, updateWord } from "../services/words";
import { prepareWord } from "../services/prepare-word";
import { broadcastWord } from "../bot/word-flow";

/** Как слово идёт у этого человека: нет карточки — убрал у себя («🙈 Не для меня»). */
export type WordStatus = "new" | "learning" | "known" | "hard" | "dropped";

export interface AppWordItem {
  id: number;
  term: string;
  translation: string;
  usefulness: number | null;
  status: WordStatus;
}

/** Слова текущей комнаты, новые сверху, со статусом по карточкам этого человека. */
export async function appWords(deps: Deps, user: User): Promise<{ room: string | null; words: AppWordItem[] }> {
  const room = user.currentRoomId != null ? await getRoom(deps.db, user.currentRoomId) : undefined;
  if (!room) return { room: null, words: [] };
  const list = await listRoomWords(deps.db, room.id);
  const ids = list.map((w) => w.id);
  const mine = ids.length ? await deps.db.select().from(cards).where(and(eq(cards.userId, user.id), inArray(cards.wordId, ids))) : [];
  const forgot = new Map<number, number>();
  const cardIds = mine.map((c) => c.id);
  if (cardIds.length) {
    const logs = await deps.db
      .select({ cardId: reviewLogs.cardId })
      .from(reviewLogs)
      .where(and(inArray(reviewLogs.cardId, cardIds), eq(reviewLogs.rating, "again")));
    for (const { cardId } of logs) forgot.set(cardId, (forgot.get(cardId) ?? 0) + 1);
  }
  const byWord = new Map(mine.map((c) => [c.wordId, c]));
  return {
    room: room.name,
    words: list.map((w) => {
      const card = byWord.get(w.id);
      const status: WordStatus = !card
        ? "dropped"
        : card.state === State.New
          ? "new"
          : (forgot.get(card.id) ?? 0) >= HARD_AFTER_LAPSES
            ? "hard"
            : isLearned(card)
              ? "known"
              : "learning";
      return { id: w.id, term: w.term, translation: w.translation, usefulness: w.usefulness, status };
    }),
  };
}

/** Слово — только из комнаты, где человек состоит: чужие слова через API не достать и не изменить. */
export async function memberWord(deps: Deps, user: User, wordId: number): Promise<Word | undefined> {
  const word = Number.isInteger(wordId) ? await getWord(deps.db, wordId) : undefined;
  return word && (await isMember(deps.db, word.roomId, user.id)) ? word : undefined;
}

export async function appWordDetails(deps: Deps, user: User, word: Word) {
  const [card] = await deps.db.select({ id: cards.id }).from(cards).where(and(eq(cards.userId, user.id), eq(cards.wordId, word.id)));
  return {
    id: word.id,
    term: word.term,
    translation: word.translation,
    explanation: word.explanation,
    example: word.example,
    context: word.context,
    moreContexts: JSON.parse(word.moreContexts || "[]") as Array<{ text: string; title: string }>,
    collocations: storedCollocations(word)?.items ?? [],
    mnemonic: word.mnemonic,
    transcriptionUk: word.transcriptionUk,
    transcriptionUs: word.transcriptionUs,
    usefulness: word.usefulness,
    hasPicture: Boolean(word.imageFileId || deps.pictures?.find(word)),
    mine: Boolean(card),
  };
}

export type WordAction = "drop" | "restore" | "promote" | "delete";

/** Те же действия, что «⚙️ Управление словом» в боте. */
export async function appWordAction(deps: Deps, user: User, word: Word, action: WordAction): Promise<void> {
  if (action === "drop") await dropCard(deps.db, user.id, word.id);
  else if (action === "restore") await restoreCard(deps.db, user.id, word.id, deps.now());
  else if (action === "promote") await setUsefulness(deps.db, word.id, 2, "отмечено вручную как полезное");
  else await deleteWord(deps.db, word.id);
}

/** ✏️ Перевод и объяснение; слово и пример — как были. Прогресс у всех сохраняется. */
export async function appEditWord(deps: Deps, word: Word, body: { translation?: unknown; explanation?: unknown }) {
  const translation = typeof body.translation === "string" ? body.translation.trim().slice(0, 300) : "";
  const explanation = typeof body.explanation === "string" ? body.explanation.trim().slice(0, 1000) : word.explanation;
  if (!translation) return { ok: false as const, error: "Перевод не может быть пустым" };
  await updateWord(deps.db, word.id, { translation, explanation, example: word.example });
  return { ok: true as const };
}

export async function appSettings(deps: Deps, user: User) {
  const rooms = await listUserRooms(deps.db, user.id);
  const view = cardView(user);
  return {
    rooms: rooms.map((r) => ({ id: r.id, name: r.name, current: r.id === user.currentRoomId })),
    reminderHour: Number(user.reminderTime.slice(0, 2)),
    notifyDue: user.notifyDue,
    weeklyReport: user.weeklyReport,
    modes: MODE_LABELS.map(([key, label, field]) => ({ key, label, on: Boolean(user[field]) })),
    drill: user.modeDrill,
    card: CARD_PART_LABELS.map(([key, label]) => ({ key, label, on: view[key] })),
  };
}

/** Одна настройка за раз — как одна кнопка в /settings. Ошибка — текстом для человека. */
export async function appChangeSetting(deps: Deps, user: User, body: Record<string, unknown>): Promise<{ ok: true; user: User } | { ok: false; error: string }> {
  let patch: UserPatch | undefined;
  if (typeof body.room === "number") {
    if (!(await isMember(deps.db, body.room, user.id))) return { ok: false, error: "Ты не в этой комнате" };
    patch = { currentRoomId: body.room };
  } else if (typeof body.reminderHour === "number" && Number.isInteger(body.reminderHour) && body.reminderHour >= 0 && body.reminderHour <= 23) {
    patch = { reminderTime: `${String(body.reminderHour).padStart(2, "0")}:00` };
  } else if (typeof body.notifyDue === "boolean") patch = { notifyDue: body.notifyDue };
  else if (typeof body.weeklyReport === "boolean") patch = { weeklyReport: body.weeklyReport };
  else if (typeof body.drill === "boolean") patch = { modeDrill: body.drill };
  else if (typeof body.mode === "string" && typeof body.on === "boolean") {
    const entry = MODE_LABELS.find(([key]) => key === body.mode);
    if (!entry) return { ok: false, error: "Нет такого режима" };
    const field = entry[2];
    if (!body.on && MODE_LABELS.every(([, , f]) => f === field || !user[f])) return { ok: false, error: "Хотя бы один режим должен остаться включённым" };
    patch = { [field]: body.on };
  } else if (typeof body.cardPart === "string" && typeof body.on === "boolean") {
    const part = body.cardPart as CardPart;
    if (!CARD_PARTS.includes(part)) return { ok: false, error: "Нет такой части карточки" };
    if (cardView(user)[part] !== body.on) patch = { cardHidden: toggleCardPart(user.cardHidden, part) };
    else return { ok: true, user };
  }
  if (!patch) return { ok: false, error: "Непонятная настройка" };
  return { ok: true, user: await updateUser(deps.db, user.id, patch) };
}

/** ➕ Слово из приложения, шаг 1: черновик (как /add) — перевод, транскрипция, пример, полезность, запоминалка. */
export async function appPrepareWord(deps: Deps, user: User, body: { text?: unknown }) {
  const parsed = typeof body.text === "string" ? parseAddInput(body.text.slice(0, 200)) : null;
  if (!parsed) return { status: 400, body: { ok: false, error: "Напиши слово или фразу" } };
  if (user.currentRoomId == null) return { status: 400, body: { ok: false, error: "Сначала выбери комнату в настройках" } };
  const prepared = await prepareWord(deps, user.currentRoomId, parsed);
  if (prepared.status === "exists") return { status: 409, body: { ok: false, error: `«${prepared.term}» уже есть в комнате` } };
  if (prepared.status === "no-english") return { status: 422, body: { ok: false, error: `Не получилось подобрать английское слово для «${prepared.term}» — напиши по-английски` } };
  return { status: 200, body: { ok: true, draft: prepared.draft } };
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Шаг 2: сохранить (перевод и объяснение человек мог поправить) и разослать друзьям «знаешь?», как из бота. */
export async function appAddWord(deps: Deps, user: User, body: Record<string, unknown>) {
  const term = text(body.term, 120);
  const translation = text(body.translation, 300);
  if (!term || !translation) return { status: 400, body: { ok: false, error: "Нужны слово и перевод" } };
  if (user.currentRoomId == null) return { status: 400, body: { ok: false, error: "Сначала выбери комнату в настройках" } };
  const usefulness = typeof body.usefulness === "number" && [1, 2, 3].includes(body.usefulness) ? body.usefulness : null;
  const result = await saveWord(deps.db, {
    roomId: user.currentRoomId,
    addedBy: user.id,
    draft: {
      term,
      translation,
      explanation: text(body.explanation, 1000),
      example: text(body.example, 500),
      transcriptionUk: text(body.transcriptionUk, 120),
      transcriptionUs: text(body.transcriptionUs, 120),
      mnemonic: text(body.mnemonic, 1000),
      usefulness,
      usefulnessNote: text(body.usefulnessNote, 300),
    },
    now: deps.now(),
  });
  if (result.status === "duplicate") return { status: 409, body: { ok: false, error: `«${term}» уже есть в комнате` } };
  if (result.status === "no-room") return { status: 400, body: { ok: false, error: "Комнату уже удалили" } };
  void broadcastWord(deps, result.word, result.members, user).catch((err) => console.error("App word broadcast failed", err));
  return { status: 200, body: { ok: true, id: result.word.id } };
}

/** 💡 Другая запоминалка для слова — для всей комнаты, как и прежняя. */
export async function appNewMnemonic(deps: Deps, word: Word) {
  try {
    const [mnemonic] = await deps.tutor.mnemonics([{ term: word.term, translation: word.translation, instead: word.mnemonic || undefined }]);
    if (!mnemonic) return { status: 502, body: { ok: false, error: "Не получилось придумать — попробуй ещё раз" } };
    await setMnemonic(deps.db, word.id, mnemonic);
    return { status: 200, body: { ok: true, mnemonic } };
  } catch (err) {
    console.error("App mnemonic failed", err);
    return { status: 502, body: { ok: false, error: "Не получилось придумать — попробуй ещё раз" } };
  }
}
