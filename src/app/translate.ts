import { randomUUID } from "node:crypto";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import type { TranslationDirection, TranslationReview, TranslationTask } from "../llm/tutor";
import { checkAndCount } from "../services/limits";
import { recordStudyActivity } from "../services/study-activities";
import { translationMaterial } from "../services/translate";
import { normalizeTerm } from "../services/words";

const TTL = 30 * 60_000;
type Player = Pick<User, "id" | "timezone">;

export type AppTranslationResult = {
  answer: string;
  reference: string;
  review?: TranslationReview;
};
export type AppTranslation = {
  id: string;
  direction: TranslationDirection;
  source: string;
  result?: AppTranslationResult;
};
type Exercise = { id: string; direction: TranslationDirection; task: TranslationTask; result?: AppTranslationResult };
type Session = { recent: string[]; exercise?: Exercise; busy: boolean; timeout?: ReturnType<typeof setTimeout> };
type Reply = { status: 200; body: { ok: true; exercise: AppTranslation | null } }
  | { status: 400 | 409 | 410 | 429 | 503; body: { ok: false; error: string } };

function show(exercise: Exercise | undefined): Reply {
  return { status: 200, body: { ok: true, exercise: exercise ? {
    id: exercise.id, direction: exercise.direction, result: exercise.result,
    source: exercise.direction === "en-ru" ? exercise.task.en : exercise.task.ru,
  } : null } };
}
const fail = (status: Exclude<Reply["status"], 200>, error: string): Reply => ({ status, body: { ok: false, error } });

export class AppTranslate {
  private readonly sessions = new Map<number, Session>();

  constructor(private readonly deps: Pick<Deps, "db" | "now" | "random" | "tutor">) {}

  current(userId: number): Reply {
    return show(this.sessions.get(userId)?.exercise);
  }

  async next(user: Player, body: Record<string, unknown>): Promise<Reply> {
    const { direction, previousId } = body;
    if (direction !== "ru-en" && direction !== "en-ru") return fail(400, "Выбери направление перевода.");
    const session = this.sessions.get(user.id) ?? { recent: [], busy: false };
    if (session.busy) return fail(409, "Предложение уже готовится.");
    if (session.exercise && session.exercise.id !== previousId) return show(session.exercise);
    this.sessions.set(user.id, session);
    this.keep(user.id, session);
    session.busy = true;
    try {
      const denied = await this.quota(user);
      if (denied) return denied;
      const { db, now, random, tutor } = this.deps;
      const material = await translationMaterial(db, user.id, now(), random, session.recent);
      const task = await tutor.translationTask({ topics: material.topics, words: material.words, avoid: material.avoid });
      session.exercise = { id: randomUUID(), direction, task };
      session.recent = [...session.recent, task.ru].slice(-8);
      return show(session.exercise);
    } catch {
      console.error("App translation task failed");
      return fail(503, "Не получилось подготовить предложение. Попробуй ещё раз.");
    } finally {
      session.busy = false;
    }
  }

  async answer(user: Player, body: Record<string, unknown>): Promise<Reply> {
    const session = this.sessions.get(user.id);
    const exercise = session?.exercise;
    if (!session || !exercise || exercise.id !== body.id) return fail(410, "Это задание уже закончилось.");
    if (exercise.result) return show(exercise);
    if (session.busy) return fail(409, "Перевод уже проверяется.");
    const reference = exercise.direction === "en-ru" ? exercise.task.ru : exercise.task.en;
    if (body.skip === true) {
      exercise.result = { answer: "", reference };
      return show(exercise);
    }
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    const language = exercise.direction === "en-ru" ? /[а-яё]/i : /[a-z]/i;
    if (!language.test(answer) || answer.length > 600) {
      return fail(400, exercise.direction === "en-ru" ? "Напиши перевод по-русски." : "Напиши перевод по-английски.");
    }

    session.busy = true;
    this.keep(user.id, session);
    try {
      const denied = await this.quota(user);
      if (denied) return denied;
      const { db, now, tutor } = this.deps;
      const { task, direction } = exercise;
      const review = await tutor.reviewTranslation({ task, direction, answer });
      if (review.correct) {
        const sentence = normalizeTerm(task.ru).replace(/[\p{P}\p{S}]/gu, "").trim();
        await recordStudyActivity(db, user, now(), "translate", sentence, 0);
      }
      exercise.result = { answer, reference, review };
      return show(exercise);
    } catch {
      console.error("App translation answer failed");
      return fail(503, "Не получилось проверить перевод. Попробуй отправить его ещё раз.");
    } finally {
      session.busy = false;
    }
  }

  private async quota(user: Player): Promise<Reply | undefined> {
    const { db, now } = this.deps;
    const quota = await checkAndCount(db, { kind: "app_translate", userId: user.id, timeZone: user.timezone, now: now() });
    if (!quota.allowed) return fail(429, quota.refusal);
  }

  private keep(userId: number, session: Session) {
    clearTimeout(session.timeout);
    session.timeout = setTimeout(() => this.sessions.delete(userId), TTL).unref();
  }
}
