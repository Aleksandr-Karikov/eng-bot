import type { StudyLanguage } from "./language";
import { retrieveRawInitData } from "@telegram-apps/sdk-react";

/** Вопрос с вариантами; filled — предложение с верным ответом на месте пропуска. */
export interface Quiz {
  question: string;
  options: string[];
  correct: number;
  explanation: string;
  filled: { before: string; answer: string; after: string };
}

export interface Card {
  kind: "card";
  /** Режим «Трудные»: вне зачёта, ответы не оцениваются. */
  practice?: boolean;
  cardId: number;
  reps: number;
  isNew: boolean;
  stage: "en_ru" | "ru_en" | "collocation" | "cloze" | "listen" | "sentence";
  /** Для «вставь по смыслу»: предложение с пропуском и перевод. */
  cloze?: { id: number; sentence: string; translation: string };
  /** Для сочетаний: вопрос и частые сочетания слова. */
  quiz?: Quiz & { items: Array<{ phrase: string; translation: string }> };
  word: {
    id: number;
    term: string;
    translation: string;
    explanation: string;
    example: string;
    context: string;
    mnemonic: string;
    transcriptionUk: string;
    transcriptionUs: string;
    usefulness: number | null;
    hasPicture: boolean;
  };
}

export interface Me {
  name: string;
  room: string | null;
  due: { review: number; fresh: number };
  /** Какие части карточки показывать (⚙️ → 🃏 Карточка). */
  view: CardView;
  /** Сколько новых слов от друзей ждут разбора. */
  triage: number;
  /** Изучаемый язык текущей комнаты. */
  language?: StudyLanguage;
}

export type CardView = Record<"transcription" | "explanation" | "example" | "context" | "collocations" | "mnemonic" | "audio" | "picture", boolean>;

export type Answer = "again" | "good" | "easy";

function initData(): string {
  try {
    return retrieveRawInitData() ?? "";
  } catch {
    return "";
  }
}

/**
 * Все запросы — с подписанными данными запуска Telegram: по ним бот понимает, кто это.
 * ngrok-skip-browser-warning — иначе бесплатный ngrok отдаёт на запрос свою страницу-предупреждение вместо JSON.
 */
const headers = () => ({ authorization: `tma ${initData()}`, "ngrok-skip-browser-warning": "1" });

/** Ошибка сервера с кодом: 409 — «уже учтено» (карточку уже оценили). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...init?.headers, ...headers() } });
  if (res.status === 401) throw new Error("Открой приложение из бота");
  // Ошибки действий («Хотя бы один режим должен остаться…») сервер присылает текстом для человека.
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(body.error ?? `Ошибка ${res.status}`, res.status);
  return body as T;
}

const post = <T>(path: string, body: object = {}) =>
  call<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getMe = () => call<Me & { ok: true }>("/api/me");

/** Ошибка на телефоне — в лог бота: иначе о ней знает только тот, у кого она случилась. */
export function reportClientError(where: string, err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  void post("/api/client-error", { where, message, ua: navigator.userAgent }).catch(() => {});
}
/** 🧠 Вопрос по ошибкам между карточками. */
export interface DrillItem extends Quiz {
  kind: "drill";
  id: string;
  category: string;
}

export type QueueItem = Card | DrillItem;

/** Счёт темы ошибок после ответа: resolved — тема отработана. */
export interface DrillProgress {
  category: string;
  streak: number;
  resolved: boolean;
}

/** Режим тренировки: всё, только повторения, только новые, трудные (вне зачёта). */
export type QueueMode = "all" | "reviews" | "fresh" | "hard";

export const getQueue = (mode: QueueMode = "all") => call<{ cards: QueueItem[] }>(`/api/queue?mode=${mode}`).then((r) => r.cards);
export const sendDrillAnswer = (item: DrillItem, correct: boolean) =>
  post<{ progress: DrillProgress | null }>("/api/drill", { category: item.category, correct }).then((r) => r.progress);
export const sendAnswer = (card: Card, answer: Answer) =>
  post("/api/answer", { cardId: card.cardId, reps: card.reps, answer, stage: card.stage, practice: card.practice });
export const undoAnswer = (card: Card) => post("/api/undo", { cardId: card.cardId });

/** Новое слово друга в колоде на разбор. */
export interface TriageCard {
  cardId: number;
  addedBy: string;
  word: Card["word"];
}

export type TriageAction = "learn" | "know" | "drop";

export const getTriage = () => call<{ cards: TriageCard[] }>("/api/triage").then((r) => r.cards);
export const sendTriage = (card: TriageCard, action: TriageAction, undo = false) =>
  post("/api/triage", { cardId: card.cardId, wordId: card.word.id, action, undo });

/** Как слово идёт у меня: dropped — убрал у себя («🙈 Не для меня»). */
export type WordStatus = "new" | "learning" | "known" | "hard" | "dropped";

export interface WordItem {
  id: number;
  term: string;
  translation: string;
  usefulness: number | null;
  status: WordStatus;
}

export interface WordDetails extends Omit<Card["word"], "id"> {
  id: number;
  moreContexts: Array<{ text: string; title: string }>;
  collocations: Array<{ phrase: string; translation: string }>;
  /** Есть ли слово в моих карточках. */
  mine: boolean;
}

export type WordAction = "drop" | "restore" | "promote" | "delete";

export const getWords = () => call<{ room: string | null; words: WordItem[] }>("/api/words");
export const getWord = (id: number) => call<{ word: WordDetails }>(`/api/words/${id}`).then((r) => r.word);
export const editWord = (id: number, patch: { translation: string; explanation: string }) => post(`/api/words/${id}/edit`, patch);
export const wordAction = (id: number, action: WordAction) => post(`/api/words/${id}/${action}`);

export interface Toggle {
  key: string;
  label: string;
  on: boolean;
}

export interface Settings {
  rooms: Array<{ id: number; name: string; current: boolean }>;
  reminderHour: number;
  notifyDue: boolean;
  weeklyReport: boolean;
  modes: Toggle[];
  drill: boolean;
  card: Toggle[];
}

/** Одна настройка за раз, например { reminderHour: 9 } или { mode: "cloze", on: false }. */
export type SettingChange =
  | { room: number }
  | { reminderHour: number }
  | { notifyDue: boolean }
  | { weeklyReport: boolean }
  | { drill: boolean }
  | { mode: string; on: boolean }
  | { cardPart: string; on: boolean };

export const getSettings = () => call<{ settings: Settings }>("/api/settings").then((r) => r.settings);
export const changeSetting = (change: SettingChange) => post<{ settings: Settings }>("/api/settings", change).then((r) => r.settings);

/** Картинка и озвучка тоже под подписью — <img>/<audio> так не умеют, поэтому через fetch и blob-ссылку. */
export async function mediaUrl(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(path, { headers: headers() });
    return res.ok ? URL.createObjectURL(await res.blob()) : undefined;
  } catch {
    return undefined;
  }
}

/** Картинки — по одной загрузке: кэш blob-ссылок, чтобы подгрузить заранее и не качать дважды. */
const pictures = new Map<string, Promise<string | undefined>>();

function cachedPicture(query: string): Promise<string | undefined> {
  let url = pictures.get(query);
  if (!url) {
    url = mediaUrl(`/api/picture?${query}`);
    pictures.set(query, url);
  }
  return url;
}

export const pictureUrl = (cardId: number) => cachedPicture(`card=${cardId}`);
export const wordPictureUrl = (wordId: number) => cachedPicture(`word=${wordId}`);

/** Итог проверки ответа текстом. unchecked — проверить не вышло: человек оценивает себя сам. */
export interface CheckResult {
  correct?: boolean;
  unchecked?: boolean;
  /** Диктант: exact — верно, close — с опечаткой (засчитано), wrong — нет. */
  grade?: "exact" | "close" | "wrong";
  term: string;
  translation: string;
  transcriptionUk: string;
  transcriptionUs: string;
  example: string;
  /** Вставь по смыслу: предложение с ответом и перевод предложения. */
  filled?: { before: string; answer: string; after: string };
  explanation?: string;
  tip?: string;
  /** Своё предложение: разбор как в /check. */
  verdict?: string;
  corrected?: string;
  fixes?: Array<{ wrong: string; right: string; why: string; slip?: boolean }>;
  natural?: string;
  mistakesId?: number;
}

export const checkAnswer = (card: Card, answer: string, dunno = false) =>
  post<CheckResult>("/api/check", { cardId: card.cardId, reps: card.reps, stage: card.stage, answer, clozeId: card.cloze?.id, dunno, practice: card.practice });
export const saveMistakes = (id: number, save: boolean) => post("/api/mistakes", { id, save });

export interface Progress {
  stats: { total: number; learned: number; learning: number; fresh: number; reviews7d: number; streak: number };
  started7d: number;
  calendar: Array<{ date: string; count: number }>;
  forecast: Array<{ date: string; count: number }>;
  goal?: { room: string; target: number; done: number; auto: boolean; byUser: Array<{ name: string; count: number }> };
  topics: Array<{ category: string; count: number; streak: number }>;
  resolveStreak: number;
  resolved: string[];
}

export const getProgress = () => call<Progress & { ok: true }>("/api/progress");

/** Черновик нового слова — как в /add: всё, что подготовила модель; перевод и объяснение можно поправить. */
export interface WordDraft {
  term: string;
  translation: string;
  explanation: string;
  example: string;
  transcriptionUk?: string;
  transcriptionUs?: string;
  mnemonic?: string;
  usefulness?: number | null;
  usefulnessNote?: string;
}

export const prepareWord = (text: string) => post<{ draft: WordDraft }>("/api/words/prepare", { text }).then((r) => r.draft);
export const addWord = (draft: WordDraft) => post<{ id: number }>("/api/words", draft);

/** 🎧 Аудиоурок придёт в чат с ботом: started — собирается, busy — уже собирается, empty — слушать пока нечего. */
export type LessonAccent = "uk" | "us" | "mix";
export const requestLesson = (accent: LessonAccent) =>
  post<{ status: "started" | "busy" | "empty" }>("/api/lesson", { accent }).then((r) => r.status);

/** 💡 Другая запоминалка (для всей комнаты). */
export const newMnemonic = (id: number) => post<{ mnemonic: string }>(`/api/words/${id}/mnemonic`).then((r) => r.mnemonic);

/** 📦 Готовый набор слов и сколько в нём уже разобрано. */
export interface WordSetInfo {
  id: number;
  title: string;
  description: string;
  kind: "level" | "topic";
  total: number;
  done: number;
}

export interface SetItem {
  id: number;
  term: string;
  translation: string;
  explanation: string;
  example: string;
  transcriptionUk: string;
  transcriptionUs: string;
  usefulness: number | null;
}

export const getSets = () => call<{ sets: WordSetInfo[] }>("/api/sets").then((r) => r.sets);
export const getSetItems = (id: number) => call<{ set: { id: number; title: string }; remaining: number; items: SetItem[] }>(`/api/sets/${id}`);
export const decideSetItem = (item: SetItem, decision: "learn" | "know" | "drop", undo = false) =>
  post("/api/sets/decide", { itemId: item.id, decision, undo });
