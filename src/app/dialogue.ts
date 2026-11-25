import { randomUUID } from "node:crypto";
import type { Deps } from "../bot/context";
import type { User, Word } from "../db/schema";
import type { DialogueScene, DialogueTurn, SentenceReview } from "../llm/tutor";
import { prepareDialogue } from "../services/dialogue";
import { checkAndCount } from "../services/limits";
import { getDueItemByCard, recordAnswer } from "../services/review";
import { sentenceFeedback } from "./exercises";

type Status = 200 | 400 | 404 | 409 | 410 | 425 | 429 | 503;
type Result = { status: Status; body: Record<string, unknown> };
const ok = (body: object): Result => ({ status: 200, body: { ok: true, ...body } });
const fail = (status: Status, error: string): Result => ({ status, body: { ok: false, error } });
const expired = () => fail(410, "Диалог уже закончился. Можно перейти к обычной карточке.");
const stale = () => fail(409, "Карточка уже засчитана");
const TTL = 30 * 60_000;

type Session = {
  id: string;
  cardId: number;
  reps: number;
  practice: boolean;
  word: Pick<Word, "term" | "translation" | "explanation">;
  opening: Promise<Result>;
  scene?: DialogueScene;
  busy?: boolean;
  retryOffered?: boolean;
  first?: { answer: string; followUp?: DialogueTurn };
  finished?: boolean;
  last?: { turn: number; answer: string; result: Result };
};

export class AppDialogues {
  private readonly sessions = new Map<number, Session>();

  constructor(private readonly deps: Deps) {}

  async open(user: User, body: { cardId?: unknown; reps?: unknown; practice?: unknown }): Promise<Result> {
    const { cardId, reps } = body;
    const practice = body.practice === true;
    if (typeof cardId !== "number" || !Number.isInteger(cardId) || typeof reps !== "number" || !Number.isInteger(reps)) {
      return fail(400, "Не получилось открыть диалог. Обнови карточку.");
    }
    const item = await getDueItemByCard(this.deps.db, user.id, cardId);
    if (!item) return fail(404, "Это слово уже удалили");
    if (item.card.reps !== reps) return stale();
    if (!user.modeSentence) return fail(410, "Диалоги выключены в настройках");
    const current = this.sessions.get(user.id);
    const { term, translation, explanation } = item.word;
    if (current?.cardId === cardId && current.reps === reps && current.practice === practice && !current.first &&
        current.word.term === term && current.word.translation === translation && current.word.explanation === explanation) return current.opening;

    const id = randomUUID();
    const opening = this.prepare(user, cardId, item.word, id);
    const session: Session = { id, cardId, reps, practice, word: { term, translation, explanation }, opening };
    this.sessions.set(user.id, session);
    const result = await opening;
    if (this.sessions.get(user.id) !== session) return expired();
    if (result.status !== 200) this.sessions.delete(user.id);
    else {
      setTimeout(() => {
        if (this.sessions.get(user.id) === session) this.sessions.delete(user.id);
      }, TTL).unref();
    }
    return result;
  }

  private async prepare(user: User, cardId: number, word: Word, id: string): Promise<Result> {
    try {
      const denied = await this.checkQuota(user);
      if (denied) return denied;
      const scene = await prepareDialogue(this.deps.db, this.deps.tutor, cardId, word);
      const session = this.sessions.get(user.id);
      if (scene && session?.id === id) {
        session.scene = scene;
        return ok({ id, ...scene });
      }
    } catch {
      console.error("App dialogue scene failed");
    }
    return fail(503, "Не получилось подготовить диалог");
  }

  async answer(user: User, body: { id?: unknown; turn?: unknown; answer?: unknown; dunno?: unknown }): Promise<Result> {
    const { turn } = body;
    const dunno = body.dunno === true;
    const answer = typeof body.answer === "string" ? body.answer.trim() : "";
    if ((turn !== 1 && turn !== 2) || (dunno ? turn !== 1 || !!answer : !answer || answer.length > 500)) {
      return fail(400, "Не получилось разобрать ответ. Попробуй ещё раз.");
    }
    const session = this.sessions.get(user.id);
    if (!session?.scene || session.id !== body.id) return expired();
    if (session.last?.turn === turn && session.last.answer === answer) return session.last.result;
    if (session.busy) return fail(425, "Ответ уже проверяется");
    if (turn === 1 ? session.first : session.finished || !session.first?.followUp) return expired();

    session.busy = true;
    try {
      const result = await this.check(user, session, session.scene, turn, answer);
      if (result.status === 200) session.last = { turn, answer, result };
      return result;
    } finally {
      session.busy = false;
    }
  }

  private async check(user: User, session: Session, scene: DialogueScene, turn: 1 | 2, answer: string): Promise<Result> {
    const item = await getDueItemByCard(this.deps.db, user.id, session.cardId);
    if (!item) return fail(404, "Это слово уже удалили");
    const { term, translation, explanation, transcriptionUk, transcriptionUs, example } = item.word;
    if (session.word.term !== term || session.word.translation !== translation || session.word.explanation !== explanation) return expired();
    if (turn === 1 && item.card.reps !== session.reps) return stale();
    let review: SentenceReview | undefined;
    if (answer) {
      const denied = await this.checkQuota(user);
      if (denied) return denied;
      const first = session.first;
      try {
        review = await this.deps.tutor.reviewSentence({
          term, translation, explanation, answer,
          dialogue: first?.followUp
            ? { line: first.followUp.line, previous: { line: scene.line, answer: first.answer } }
            : { line: scene.line, askAgain: true },
        });
      } catch {
        console.error("App dialogue review failed");
        return fail(503, "Не получилось проверить ответ");
      }
    }
    if (this.sessions.get(user.id) !== session) return expired();
    if (turn === 1 && review && !review.usesWord && !session.retryOffered) {
      session.retryOffered = true;
      return ok({ retry: true, verdict: review.verdict });
    }

    let damage = 0;
    if (turn === 1 && !session.practice) {
      const rated = await recordAnswer(this.deps.db, {
        userId: user.id, cardId: session.cardId, expectedReps: session.reps,
        answer: review?.usesWord ? "good" : "again", now: this.deps.now(), stage: "app_sentence",
      });
      if (rated.result !== "ok") return stale();
      damage = rated.damage;
    }
    const followUp = turn === 1 && review?.usesWord ? review.followUp : undefined;
    if (turn === 1) session.first = { answer, followUp };
    else session.finished = true;
    return ok({
      damage, term, translation, transcriptionUk, transcriptionUs, example: review?.usesWord ? "" : example,
      ...(review ? sentenceFeedback(this.deps, user, review) : { correct: false }), followUp,
    });
  }

  private async checkQuota(user: User): Promise<Result | undefined> {
    const { db, now } = this.deps;
    const quota = await checkAndCount(db, { userId: user.id, timeZone: user.timezone, now: now(), kind: "check" });
    if (!quota.allowed) return fail(429, quota.refusal);
  }
}
