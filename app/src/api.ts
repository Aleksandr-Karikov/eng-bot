import type { StudyLanguage } from "./language";
import { retryServerDown } from "./retry";
import { retrieveRawInitData } from "@telegram-apps/sdk-react";
import type { CombatTarget, HUNTER_RELICS, MobId } from "../../src/combat-mobs";
export type { CombatTarget } from "../../src/combat-mobs";

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
  extra?: true;
  cardId: number;
  reps: number;
  isNew: boolean;
  needsDecision?: true;
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
    /** Для RU → EN: смысл под переводом; пусто — не показывать. */
    meaningHint?: string;
    example: string;
    /** Перевод примера, если его уже спрашивали тапом; "" — ещё нет. */
    exampleTranslation?: string;
    context: string;
    mnemonic: string;
    transcriptionUk: string;
    transcriptionUs: string;
    usefulness: number | null;
    hasPicture: boolean;
    /** Часть речи и уровень: «существительное · B1»; пусто — ещё не готово. */
    partOfSpeech: string;
    cefr: string;
    forms: Array<{ form: string; label: string }>;
    synonyms: Array<{ term: string; translation: string }>;
    antonyms: Array<{ term: string; translation: string }>;
  };
}

export interface Me {
  name: string;
  room: string | null;
  due: {
    review: number; fresh: number; waiting: number; activeFull: boolean;
    limits?: { introduced: number; dailyLimit: number; active: number; activeLimit: number };
  };
  nextReview?: string;
  limitNotices?: Partial<Record<Exclude<QueueMode, "hard">, string>>;
  extraLabels?: Record<Exclude<QueueMode, "hard">, string>;
  /** Сколько слов у человека вообще: по нему `/learn` отличает «всё повторил» от «нечего учить». */
  total?: number;
  /** Набор, с которого начать: приходит только когда слов нет совсем. */
  starterSet?: { id: number; title: string; total: number };
  /** Какие части карточки показывать (настройки → «Карточка»). */
  view: CardView;
  /** Что играть самим при показе карточки: null — озвучка выключена. */
  voice: VoiceAccent | null;
  /** Режим «босс недели» включён: без него вкладка не показывается. */
  boss?: boolean;
  bankDamage?: boolean;
  /** Изучаемый язык текущей комнаты. */
  language?: StudyLanguage;
}

export type CardView = Record<"transcription" | "explanation" | "example" | "context" | "collocations" | "mnemonic" | "audio" | "picture", boolean>;

/** Вариант произношения. */
export type VoiceAccent = "uk" | "us";

export type Answer = "again" | "good" | "easy";
export type CardAnswer = Answer | "know" | "drop";

function initData(): string {
  try {
    return retrieveRawInitData() ?? "";
  } catch {
    return "";
  }
}

/**
 * Все запросы — с подписанными данными запуска Telegram: по ним бот понимает, кто это.
 */
const headers = () => ({ authorization: `tma ${initData()}` });

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

/**
 * POST, который не страшно повторить, если сервер не ответил (E36).
 *
 * Пока процесс бота перезапускается после падения, Nginx отдаёт 502. Без повтора ответ человека
 * пропадал молча; с ним он доходит со второй попытки. Повторяем только то, что сервер сам защищает
 * от двойного срабатывания: оценка карточки сверяет `reps`, бой босса — `requestId`, диктант и cloze —
 * тоже `reps`, а покупка усиления проверяет баланс.
 *
 * Чего здесь нет намеренно: черновики и квоты (`/prepare`, `/mnemonic`, генерация) — повтор потратил бы
 * лимит дважды, и «сохранить ошибки» — повтор дописал бы их ещё раз.
 */
const postRetry = <T>(path: string, body: object = {}) =>
  retryServerDown(() => post<T>(path, body));

export const getMe = () => call<Me & { ok: true }>("/api/me");

/**
 * Сообщить боту пояс телефона. Telegram пояса не отдаёт, а от него зависят границы недели босса,
 * поэтому приложение — единственный честный источник. Ошибку не показываем: пояс — не то, ради чего
 * человек открыл приложение, и сбой здесь не должен мешать учиться.
 */
export function reportTimezone(): void {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timezone = undefined;
  }
  if (!timezone) return;
  void post("/api/timezone", { timezone }).catch(() => {});
}

/** Ошибка на телефоне — в лог бота: иначе о ней знает только тот, у кого она случилась. */
export function reportClientError(where: string, err: unknown): void {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  void post("/api/client-error", { where, message, ua: navigator.userAgent }).catch(() => {});
}
/** Вопрос по ошибкам между карточками. */
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

export const getQueue = (mode: QueueMode = "all", extra = false) =>
  call<{ cards: QueueItem[] }>(`/api/queue?mode=${mode}${extra ? "&extra=1" : ""}`).then((r) => r.cards);
export const sendDrillAnswer = (item: DrillItem, correct: boolean) =>
  post<{ progress: DrillProgress | null }>("/api/drill", { category: item.category, correct }).then((r) => r.progress);
export const sendAnswer = (card: Card, answer: CardAnswer) =>
  postRetry<{ result: "ok" | "stale" | "practice" | "waiting"; damage: number }>("/api/answer", { cardId: card.cardId, reps: card.reps, answer, stage: card.stage, practice: card.practice, extra: card.extra });
export const undoAnswer = (card: Card) => postRetry("/api/undo", { cardId: card.cardId });

/** Как слово идёт у меня: dropped — убрал у себя («Не для меня»). */
export type WordStatus = "new" | "learning" | "known" | "hard" | "paused" | "dropped";

export interface WordItem {
  id: number;
  term: string;
  translation: string;
  usefulness: number | null;
  status: WordStatus;
  room?: string;
}

export interface WordDetails extends Omit<Card["word"], "id"> {
  leechHelp: string;
  usefulnessNote: string;
  partOfSpeech: string;
  cefr: string;
  forms: Array<{ form: string; label: string }>;
  synonyms: Array<{ term: string; translation: string }>;
  antonyms: Array<{ term: string; translation: string }>;
  id: number;
  moreContexts: Array<{ text: string; title: string }>;
  collocations: Array<{ phrase: string; translation: string }>;
  /** Есть ли слово в моих карточках. */
  mine: boolean;
}

export type WordAction = "drop" | "restore" | "promote" | "delete";

export const getWords = () => call<{ room: string | null; words: WordItem[]; active: WordItem[]; limit: number }>("/api/words");
export const getWord = (id: number) => call<{ word: WordDetails }>(`/api/words/${id}`).then((r) => r.word);
export interface CorrectionPreview {
  draftId: string;
  message: string;
  before: WordDetails;
  after: WordDetails;
  effects: string[];
}
export const correctWord = (id: number, instruction: string, draftId?: string) => post<CorrectionPreview>(`/api/words/${id}/correct`, { instruction, draftId });
export const applyCorrection = (id: number, draftId: string) => post(`/api/words/${id}/correct/apply`, { draftId });
export const editWord = (id: number, patch: { translation: string; explanation: string }) => post(`/api/words/${id}/edit`, patch);
export const wordAction = (id: number, action: WordAction) => post(`/api/words/${id}/${action}`);
export const takeWord = (id: number, replaceWordId?: number) => post(`/api/words/${id}/learn`, { replaceWordId });

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
  /** Босс недели — режим-игра поверх цели комнаты. Нет поля — режим выключен целиком (BOSS_ENABLED=0). */
  boss?: boolean;
  card: Toggle[];
  /** 🆕 Сколько новых слов показывать за день (E30). 0 — без ограничения. */
  newPerDay: number;
  activeLearningLimit: number;
  learningLimits: { max: number; recommendedDaily: number; recommendedActive: number };
  /** Озвучка карточек: accent — что включать самим, null — выключена; accents — варианты языка комнаты. */
  voice: { accent: VoiceAccent | null; accents: Array<{ key: VoiceAccent; label: string }> };
}

/** Одна настройка за раз, например { reminderHour: 9 } или { mode: "cloze", on: false }. */
export type SettingChange =
  | { room: number }
  | { reminderHour: number }
  | { notifyDue: boolean }
  | { weeklyReport: boolean }
  | { drill: boolean }
  | { boss: boolean }
  | { mode: string; on: boolean }
  | { cardPart: string; on: boolean }
  | { newPerDay: number }
  | { activeLearningLimit: number }
  /** Повторный выбор того же варианта и "off" — выключить. */
  | { voice: VoiceAccent | "off" };

export const getSettings = () => call<{ settings: Settings }>("/api/settings").then((r) => r.settings);
export const changeSetting = (change: SettingChange) => post<{ settings: Settings }>("/api/settings", change).then((r) => r.settings);

/** Картинка и озвучка тоже под подписью — <img>/<audio> так не умеют, поэтому через fetch и blob-ссылку. */
export async function mediaUrl(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${path}&v=${mediaRevision}`, { headers: headers() });
    return res.ok ? URL.createObjectURL(await res.blob()) : undefined;
  } catch {
    return undefined;
  }
}

/** После исправления URL меняется и для браузерного кэша. */
let mediaRevision = Date.now();
export function invalidateWordMedia() {
  mediaRevision++;
  pictures.clear();
}

/** Картинки — по одной загрузке: кэш blob-ссылок. */
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
  damage: number;
  correct?: boolean;
  unchecked?: boolean;
  /** Диктант: exact — верно, close — с опечаткой (засчитано), wrong — нет. */
  grade?: "exact" | "close" | "wrong";
  term: string;
  translation: string;
  transcriptionUk: string;
  transcriptionUs: string;
  example: string;
  /**
   * Вставь по смыслу: предложение с ответом и перевод предложения.
   * `parts` — куски текста и ответы по порядку: пропусков может быть два (баг #25), и тогда ответ
   * нужен на каждый. `before`/`answer`/`after` остаются для одного пропуска.
   */
  filled?: {
    before: string;
    answer: string;
    after: string;
    parts?: Array<{ text: string } | { answer: string }>;
  };
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
  postRetry<CheckResult>("/api/check", { cardId: card.cardId, reps: card.reps, stage: card.stage, answer, clozeId: card.cloze?.id, dunno, practice: card.practice });

export type DialogueTurn = { line: string; hint: string };
export type DialogueScene = DialogueTurn & { id: string; situation: string };
export type DialogueResult = (CheckResult & { followUp?: DialogueTurn }) | { retry: true; verdict: string };
export const openDialogue = (card: Card) =>
  post<DialogueScene>("/api/dialogue", { cardId: card.cardId, reps: card.reps, practice: card.practice });
export const answerDialogue = (id: string, turn: 1 | 2, answer: string, dunno: boolean) =>
  post<DialogueResult>("/api/dialogue/answer", { id, turn, answer, dunno });

export const saveMistakes = (id: number, save: boolean) => post("/api/mistakes", { id, save });

export interface Progress {
  stats: { total: number; learned: number; learning: number; fresh: number; reviews7d: number; streak: number };
  activeLearning: number;
  started7d: number;
  calendar: Array<{ date: string; count: number }>;
  forecast: Array<{ date: string; count: number }>;
  goal?: { room: string; target: number; done: number; auto: boolean; byUser: Array<{ name: string; count: number }> };
  topics: Array<{ category: string; count: number; streak: number }>;
  resolveStreak: number;
  resolved: string[];
}

export const getProgress = () => call<Progress & { ok: true }>("/api/progress");

/** 📘 Грамматика: тема в списке и упражнение. Ответ проверяет сервер — приложение его не знает. */
export interface GrammarTopic {
  id: number;
  slug: string;
  title: string;
  level: string;
  total: number;
  done: number;
  passed: boolean;
}

export interface GrammarExercise {
  id: number;
  kind: "choice" | "gap" | "order";
  prompt: string;
  /** Варианты есть только у `choice`: `gap` и `order` человек отвечает вводом с клавиатуры. */
  options?: string[];
  /** Слова для сборки — только у `order`, перемешаны на сервере. */
  words?: string[];
  solved: boolean;
}

export interface GrammarTopicView extends GrammarTopic {
  rule: string;
  examples: string[];
  exercises: GrammarExercise[];
}

export interface GrammarAnswer {
  correct: boolean;
  answer: string;
  why: string;
  done: number;
  total: number;
  passed: boolean;
  /** Урон боссу за этот ответ: 0, если режим выключен или ответ уже был засчитан. */
  bossDamage: number;
}

export const getGrammar = () => call<{ topics: GrammarTopic[]; passed: number; total: number; ok: true }>("/api/grammar");
export const getGrammarTopic = (id: number) => call<{ topic: GrammarTopicView; ok: true }>(`/api/grammar/${id}`);
export const sendGrammarAnswer = (exerciseId: number, answer: string) =>
  postRetry<{ result: GrammarAnswer; ok: true }>("/api/grammar/answer", { exerciseId, answer });

/** Босс недели: состояние боя и лента ударов. `enabled: false` — режим выключен человеком. */
export interface BossHit {
  name: string;
  damage: number;
  /** ISO-время удара. */
  at: string;
}

export interface Boss {
  room: string;
  opponent?: { id: "dragon" | "sentinel"; name: string };
  week?: string;
  /** 0…1+, больше 1 — добит с запасом. */
  damage: number;
  hp: number;
  target: number;
  done: number;
  phase: "fresh" | "angry" | "furious" | "dead";
  pace: "ahead" | "on-time" | "behind";
  daysLeft: number;
  byUser: Array<{ name: string; count: number }>;
  /** Какой по счёту босс на этой неделе (1 — первый): добили — сразу следующий. */
  round?: number;
  /** Сколько боссов комната уже добила за эту неделю. */
  kills?: number;
  /** Урон, снятый с текущего босса. */
  progress?: number;
  /** HP текущего босса: у второй ступени он толще первой, и полоска считает по нему. */
  bossHp?: number;
  /** Ступень ладдера и круг: пройден весь ладдер — начинается следующий, сильнее. */
  tier?: number;
  cycle?: number;
  /** Пояс комнаты: им подписывается время конца недели. */
  timeZone?: string;
}

/** Монеты недели и уровень усиления: монеты — это снятые HP, тратятся на +10% урона за уровень. */
export type UpgradeKind = "damage" | "listen" | "writing";
export type BossPurchase = UpgradeKind | "rune";
export interface Coins {
  offers: Array<{ kind: UpgradeKind; title: string; description: string; bonus: number; level: number; price: number | null }>;
  coins: number;
  level: number;
  /** Цена следующего уровня; null — потолок. */
  price: number | null;
}

/** Трофей: `count` — сколько раз получен, нет в earned — ещё не получен. */
export interface Trophy {
  kind: string;
  emoji: string;
  title: string;
  how: string;
}

export interface Trophies {
  all: Trophy[];
  earned: Array<{ kind: string; count: number; lastWeek: string }>;
  total: number;
  of: number;
}

export interface HunterState {
  weeks: number;
  thisWeek: boolean;
  relics: typeof HUNTER_RELICS;
}

export interface BossState {
  enabled: boolean;
  boss?: Boss;
  hits: BossHit[];
  total: number;
  coins?: Coins;
  trophies?: Trophies;
  victory?: { finalBlow?: { name: string; at: string }; teamTrophy: boolean };
  combat?: {
    bank: boolean;
    balance: number;
    attackCost: number;
    roomId: number;
    week: string;
    mobs: Array<{ id: MobId; icon: string; name: string; hp: number; reward: string; defeated: boolean }>;
    hunt?: HunterState;
    streak?: {
      days: number;
      percent: number;
      next: { days: number; percent: number } | null;
      tiers: Array<{ days: number; percent: number }>;
    };
    rune?: { price: number; owned: boolean };
  };
}

export const getBoss = () => call<BossState & { ok: true }>("/api/boss");
export const fight = (action: { bank: boolean } | { target: Exclude<CombatTarget, "boss">; roomId: number; week: string; requestId: string; maxDamageDeci: number }) =>
  postRetry<BossState & { ok: true; notice?: string }>("/api/boss/combat", action);

export type BossAttack = { id: string; revision: number } & (
  | { kind: "question"; number: number; total: number; term: string; options: string[]; nextDamage: number; missDamage: number }
  | { kind: "decision"; damage: number; nextDamage: number; missDamage: number }
  | { kind: "done"; damage: number; translation?: string }
);
export type BossMove = { move: "answer"; choice: number } | { move: "stop" | "risk" };
type AttackReply = { attack: BossAttack; arena?: BossState };

export const startBossAttack = () => postRetry<AttackReply>("/api/boss/attack");
export const moveBossAttack = (attack: BossAttack, move: BossMove) =>
  postRetry<AttackReply>("/api/boss/attack/move", { id: attack.id, revision: attack.revision, ...move });

/** Купить усиление; в ответ приходит новое состояние босса. */
export const buyUpgrade = (kind: BossPurchase) => postRetry<BossState & { ok: true }>("/api/boss/upgrade", { kind });

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

/** Аудиоурок придёт в чат с ботом: started — собирается, busy — уже собирается, empty — слушать пока нечего. */
export type LessonAccent = "uk" | "us" | "mix";
export const requestLesson = (accent: LessonAccent) =>
  post<{ status: "started" | "busy" | "empty" }>("/api/lesson", { accent }).then((r) => r.status);

/** Перевод примера с карточки: модель спрашивается один раз на слово, дальше ответ приходит из базы. */
export const exampleTranslation = (id: number) =>
  post<{ translation: string }>(`/api/words/${id}/example`).then((r) => r.translation);

/** Другая запоминалка (для всей комнаты). */
export const newMnemonic = (id: number) => post<{ mnemonic: string }>(`/api/words/${id}/mnemonic`).then((r) => r.mnemonic);

/** Готовый набор слов и сколько в нём уже разобрано. */
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

/** Комната, в которую пойдут слова набора: её выбирает человек, а не приложение. */
export interface SetTarget {
  roomId: number;
  roomName: string;
  /** Личный словарь: поведение по умолчанию, спрашивать не о чем. */
  personal: boolean;
}
export interface SetTargetState {
  target: SetTarget;
  rooms: Array<SetTarget & { current: boolean }>;
  /** Спросить один раз: есть из чего выбирать, а выбор ещё не сделан. */
  needsChoice?: boolean;
}
export const getSets = () => call<SetTargetState & { sets: WordSetInfo[] }>("/api/sets");
export const getSetTarget = () => call<SetTargetState>("/api/sets/target");
export const setSetTarget = (roomId: number) => post<SetTargetState>("/api/sets/target", { roomId });
export const getSetItems = (id: number) => call<{ set: { id: number; title: string }; remaining: number; items: SetItem[] }>(`/api/sets/${id}`);
export const decideSetItem = (item: SetItem, decision: "learn" | "know" | "drop", undo = false) =>
  post("/api/sets/decide", { itemId: item.id, decision, undo });
