import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { State } from "ts-fsrs";
import type { Deps } from "../bot/context";
import { cards, wordGuessProgress, words, type User } from "../db/schema";
import type { WordGrammar, WordGuess, WordGuessHistory, WordGuessReview } from "../llm/tutor";
import { bossEnabled } from "../services/boss";
import { storedCollocations } from "../services/collocations";
import { revealsDialogueWord } from "../services/dialogue";
import { checkAndCount } from "../services/limits";
import { recordStudyActivity } from "../services/study-activities";
import { termPattern } from "../services/word-uses";
import { normalizeTerm } from "../services/words";

const ROUND_SIZE = 3;
const ATTEMPTS = 3;
const ROUND_TTL = 30 * 60_000;
const REPLAY_AFTER = 24 * 60 * 60_000;
const GUESS_ENERGY = 2;

export interface WordGuessResult {
  term: string;
  attempts: number | null;
  previousAttempts?: number | null;
  phrase: string;
  energy?: number;
}

export interface WordGuessRound {
  id: string;
  revision: number;
  total: number;
  attemptLimit: number;
  current: { term: string; translation: string; turns: WordGuessHistory; result?: WordGuessResult } | null;
  results: WordGuessResult[];
}

export type WordGuessFeedback = WordGuessReview & { hadClues: boolean };

type GuessWord = {
  cardId: number;
  term: string;
  translation: string;
  forms: string[];
  phrase: string;
  previousAttempts?: number | null;
  turns: WordGuessHistory;
  result?: WordGuessResult;
  feedback?: Promise<FeedbackReply>;
};
type Round = { id: string; revision: number; index: number; words: GuessWord[]; busy: boolean };
type Failure = {
  status: 400 | 409 | 410 | 429 | 503; body: { ok: false; error: string };
};
type Reply = { status: 200; body: { ok: true; round: WordGuessRound | null } } | Failure;
type FeedbackReply = { status: 200; body: { ok: true; feedback: WordGuessFeedback } } | Failure;

function show(round: Round | null): Reply {
  const word = round?.words[round.index];
  return {
    status: 200,
    body: { ok: true, round: round && {
      id: round.id, revision: round.revision, total: round.words.length, attemptLimit: ATTEMPTS,
      current: word ? { term: word.term, translation: word.translation, turns: word.turns, result: word.result } : null,
      results: round.words.flatMap(({ result }) => result ? [result] : []),
    } },
  };
}

const fail = (status: Failure["status"], error: string): Failure => ({
  status, body: { ok: false, error },
});

function matchesGuess(guess: string, forms: string[]): boolean {
  const normalized = normalizeTerm(guess).replace(/[’‘`]/g, "'")
    .replace(/^[“"]+|[.!?…"”]+$/g, "").replace(/^(?:a|an|the|to) /, "");
  return Boolean(normalized) && forms.some((term) => termPattern(term).exec(normalized)?.[0] === normalized);
}

export class AppWordGuess {
  private readonly rounds = new Map<number, Round>();

  constructor(private readonly deps: Pick<Deps, "db" | "now" | "tutor" | "bossEnabled">) {}

  async open(userId: number, fresh: boolean): Promise<Reply> {
    const current = this.rounds.get(userId);
    if (current && (!fresh || current.index < current.words.length)) return show(current);

    const { db, now } = this.deps;
    const rows = await db.select({
      cardId: cards.id, term: words.term, key: words.termNormalized, translation: words.translation,
      example: words.example, forms: words.forms, collocations: words.collocations,
      previous: wordGuessProgress.attempts, playedAt: wordGuessProgress.playedAt,
    }).from(cards).innerJoin(words, eq(words.id, cards.wordId))
      .leftJoin(wordGuessProgress, eq(wordGuessProgress.cardId, cards.id))
      .where(eq(cards.userId, userId))
      .orderBy(
        sql`case when ${cards.state} = ${State.New} then 1 else 0 end`,
        sql`case when ${wordGuessProgress.playedAt} is null then 0 else 1 end`,
        wordGuessProgress.playedAt,
        sql`random()`,
      );
    const latest = this.rounds.get(userId);
    if (latest && latest !== current) return show(latest);

    const seen = new Set<string>();
    const available = rows.filter(({ key, term }) => {
      if (seen.has(key) || !/[a-z]/i.test(term) || term.length > 100) return false;
      seen.add(key);
      return true;
    });
    const cutoff = now().getTime() - REPLAY_AFTER;
    const retry = available.find((row) => row.playedAt && row.playedAt.getTime() <= cutoff && row.previous !== 1);
    const selected = (retry ? [retry, ...available.filter((row) => row !== retry)] : available).slice(0, ROUND_SIZE);
    if (!selected.length) return show(null);

    const round: Round = {
      id: randomUUID(), revision: 0, index: 0, busy: false,
      words: selected.map((row) => ({
        cardId: row.cardId,
        term: row.term,
        translation: row.translation,
        forms: [row.term, ...(JSON.parse(row.forms) as WordGrammar["forms"]).map(({ form }) => form).filter(Boolean)],
        phrase: storedCollocations(row)?.items[0]?.phrase || row.example,
        previousAttempts: row.playedAt ? row.previous : undefined,
        turns: [],
      })),
    };
    this.rounds.set(userId, round);
    setTimeout(() => {
      if (this.rounds.get(userId) === round) this.rounds.delete(userId);
    }, ROUND_TTL).unref();
    return show(round);
  }

  async move(user: Pick<User, "id" | "timezone" | "modeBoss">, body: Record<string, unknown>): Promise<Reply> {
    const { id, revision, action } = body;
    const round = this.rounds.get(user.id);
    if (!round || round.id !== id) return fail(410, "Раунд закончился. Открой новый.");
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision > round.revision) {
      return fail(400, "Обнови раунд и попробуй ещё раз.");
    }
    // После сетевого повтора показываем, куда уже дошёл игрок.
    if (revision < round.revision) return show(round);
    if (round.busy) return fail(409, "Предыдущий ход ещё обрабатывается.");
    const word = round.words[round.index];
    if (!word) return show(round);
    if (word.result) {
      if (action !== "next") return fail(409, "Перейди к следующему слову.");
      round.index++;
      round.revision++;
      return show(round);
    }
    if (action !== "skip" && action !== "clue") return fail(400, "Нужна подсказка или пропуск.");

    round.busy = true;
    try {
      if (action === "skip") {
        await this.finish(user, word, null, word.phrase);
      } else {
        const clue = typeof body.clue === "string" ? body.clue.trim() : "";
        if (!/[a-z]/i.test(clue) || clue.length > 400) return fail(400, "Напиши короткую подсказку по-английски.");
        if (word.forms.some((term) => revealsDialogueWord(clue, term))) {
          return fail(400, "Ты назвал загаданное слово. Попробуй описать его другими словами.");
        }
        if (!this.deps.tutor.guessWord) return fail(503, "Собеседник недоступен. Попробуй позже.");
        const quota = await checkAndCount(this.deps.db, {
          kind: "word_guess", userId: user.id, timeZone: user.timezone, now: this.deps.now(),
        });
        if (!quota.allowed) return fail(429, quota.refusal);
        let reply: WordGuess;
        try {
          reply = await this.deps.tutor.guessWord(clue, word.turns);
        } catch {
          console.error("Word guess reply failed");
          return fail(503, "Собеседник не ответил. Попробуй отправить подсказку ещё раз.");
        }
        if (this.rounds.get(user.id) !== round) return fail(410, "Раунд закончился. Открой новый.");
        const attempts = word.turns.length + 1;
        const won = matchesGuess(reply.guess, word.forms);
        if (won || attempts === ATTEMPTS) {
          const phrase = won && word.forms.some((term) => revealsDialogueWord(reply.phrase, term))
            ? reply.phrase : word.phrase;
          await this.finish(user, word, won ? attempts : null, phrase);
        }
        word.turns = [...word.turns, { clue, guess: reply.guess, question: won || word.result ? "" : reply.question }];
      }
      round.revision++;
      return show(round);
    } finally {
      round.busy = false;
    }
  }

  async feedback(user: Pick<User, "id" | "timezone">, body: Record<string, unknown>): Promise<FeedbackReply> {
    const { id, index } = body;
    const round = this.rounds.get(user.id);
    if (!round || round.id !== id) return fail(410, "Раунд закончился.");
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= round.words.length) {
      return fail(400, "Нет такого слова в раунде.");
    }
    const word = round.words[index];
    if (!word.result) return fail(409, "Разбор появится после завершения слова.");
    const request = word.feedback ??= this.review(user, word, word.result.attempts === null);
    const reply = await request;
    if (reply.status !== 200 && word.feedback === request) word.feedback = undefined;
    return reply;
  }

  private async review(user: Pick<User, "id" | "timezone">, word: GuessWord, needExample: boolean): Promise<FeedbackReply> {
    const { db, now, tutor } = this.deps;
    if (!tutor.reviewWordGuess) return fail(503, "Разбор пока недоступен.");
    const clues = word.turns.map(({ clue }) => clue);
    try {
      const quota = await checkAndCount(db, { kind: "word_guess", userId: user.id, timeZone: user.timezone, now: now() });
      if (!quota.allowed) return fail(429, quota.refusal);
      const { term, translation } = word;
      const review = await tutor.reviewWordGuess({ term, translation, clues, needExample });
      const example = needExample ? review.example.trim() : "";
      if (needExample && (!example || word.forms.some((form) => revealsDialogueWord(example, form)))) {
        return fail(503, "Не получилось подобрать пример. Попробуй ещё раз.");
      }
      const source = clues.map(normalizeTerm);
      const fixes = review.fixes.filter(({ wrong, right }) =>
        wrong.trim() && right.trim() && wrong.trim() !== right.trim()
        && source.some((clue) => clue.includes(normalizeTerm(wrong))),
      ).slice(0, 6);
      return { status: 200, body: { ok: true, feedback: { fixes, example, hadClues: clues.length > 0 } } };
    } catch {
      console.error("Word guess feedback failed");
      return fail(503, "Не получилось разобрать подсказки. Попробуй ещё раз.");
    }
  }

  private async finish(user: Pick<User, "id" | "timezone" | "modeBoss">, word: GuessWord, attempts: number | null, phrase: string) {
    const { db, now } = this.deps;
    const playedAt = now();
    // Пока идёт запрос к модели, человек может убрать карточку на другом устройстве.
    await db.insert(wordGuessProgress).select(db.select({
      cardId: cards.id,
      attempts: sql<number | null>`${attempts}`.as("attempts"),
      playedAt: sql<Date>`${playedAt.getTime()}`.as("played_at"),
    }).from(cards).where(and(eq(cards.id, word.cardId), eq(cards.userId, user.id))))
      .onConflictDoUpdate({ target: wordGuessProgress.cardId, set: { attempts, playedAt } });
    const energy = bossEnabled(user, this.deps.bossEnabled) ? GUESS_ENERGY : 0;
    const credited = attempts !== null && await recordStudyActivity(db, user, playedAt, "explain", normalizeTerm(word.term), energy);
    word.result = { term: word.term, attempts, previousAttempts: word.previousAttempts, phrase, ...(credited && energy ? { energy } : {}) };
  }
}
