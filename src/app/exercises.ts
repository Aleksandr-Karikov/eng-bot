import { and, eq } from "drizzle-orm";
import type { Deps } from "../bot/context";
import { gapParts, LEARNING_FULL_TEXT } from "../bot/texts";
import { clozeSentences, type User } from "../db/schema";
import type { SentenceReview } from "../llm/tutor";
import { gradeDictation, isExactAnswer } from "../services/exercises";
import { checkAndCount, type QuotaKind } from "../services/limits";
import { recordMistakes } from "../services/mistakes";
import { recordAnswer, getDueItemByCard } from "../services/review";

/**
 * Проверка пропусков и диктантов. Старые версии Mini App также присылают сюда свободное предложение.
 * Проверяет сервер (точное совпадение сразу, иначе — модель), он же и оценивает карточку: «Помню» или «Забыл».
 */
export type TypedStage = "cloze" | "listen" | "sentence";

const STAGES = new Set<TypedStage>(["cloze", "listen", "sentence"]);

type Result = { status: number; body: Record<string, unknown> };
const fail = (status: number, error: string): Result => ({ status, body: { ok: false, error } });

/**
 * Считает проверку моделью и отказывает, когда лимит выбран.
 *
 * В приложении нет `ctx.reply`, поэтому отказ возвращается как HTTP 429 с тем же русским текстом,
 * что и в боте: клиент показывает его как обычную ошибку. Считаются только те ответы, где работу
 * делает модель, — точное совпадение и «не знаю» проверяются на сервере бесплатно.
 */
async function allowModelCheck(deps: Deps, user: User, kind: QuotaKind): Promise<Result | null> {
  const state = await checkAndCount(deps.db, { userId: user.id, timeZone: user.timezone, now: deps.now(), kind });
  return state.allowed ? null : fail(429, state.refusal);
}

export async function appCheck(
  deps: Deps,
  user: User,
  body: { cardId?: unknown; reps?: unknown; stage?: unknown; answer?: unknown; clozeId?: unknown; dunno?: unknown; practice?: unknown },
): Promise<Result> {
  const cardId = Number(body.cardId);
  const reps = Number(body.reps);
  const stage = String(body.stage) as TypedStage;
  const answer = typeof body.answer === "string" ? body.answer.trim().slice(0, 500) : "";
  const dunno = body.dunno === true;
  if (!Number.isInteger(cardId) || !Number.isInteger(reps) || !STAGES.has(stage) || (!answer && !dunno)) return fail(400, "Не получилось разобрать ответ — обнови карточку и попробуй ещё раз");
  const item = await getDueItemByCard(deps.db, user.id, cardId);
  if (!item) return fail(404, "Это слово уже удалили");
  const { word } = item;
  // Вне зачёта (режим «Трудные») ответ проверяем, но карточку не оцениваем.
  let reward: { damage: number; energy?: number } = { damage: 0 };
  const rate = async (good: boolean) => {
    if (body.practice === true) return;
    const recorded = await recordAnswer(deps.db, { userId: user.id, cardId, expectedReps: reps, answer: good ? "good" : "again", now: deps.now(), stage: `app_${stage}` });
    reward = { damage: recorded.damage, energy: recorded.energy };
    if (recorded.result === "waiting") return fail(409, LEARNING_FULL_TEXT);
    if (recorded.result === "stale") return fail(409, "Уже учтено");
  };
  const reveal = { term: word.term, translation: word.translation, transcriptionUk: word.transcriptionUk, transcriptionUs: word.transcriptionUs, example: word.example };

  if (stage === "listen") {
    const grade = dunno ? "wrong" : gradeDictation(answer, word.term);
    const conflict = await rate(grade !== "wrong");
    if (conflict) return conflict;
    return { status: 200, body: { ok: true, ...reward, correct: grade !== "wrong", grade, ...reveal } };
  }

  if (stage === "cloze") {
    const [s] = await deps.db.select().from(clozeSentences).where(and(eq(clozeSentences.id, Number(body.clozeId)), eq(clozeSentences.wordId, word.id)));
    if (!s) return fail(404, "Это предложение уже заменили");
    const base = { filled: gapParts(s.sentence, s.answer), translation: s.translation };
    if (dunno || isExactAnswer(answer, { answer: s.answer, term: word.term })) {
      const conflict = await rate(!dunno);
      if (conflict) return conflict;
      return { status: 200, body: { ok: true, ...reward, correct: !dunno, ...base, ...reveal } };
    }
    const denied = await allowModelCheck(deps, user, "check");
    if (denied) return denied;
    let judgement;
    try {
      judgement = await deps.tutor.judge({ sentence: s.sentence, expected: s.answer, term: word.term, translation: word.translation, answer });
    } catch (err) {
      console.error("App cloze judge failed", err);
      return { status: 200, body: { ok: true, ...reward, unchecked: true, ...base, ...reveal } };
    }
    const conflict = await rate(judgement.correct);
    if (conflict) return conflict;
    return { status: 200, body: { ok: true, ...reward, correct: judgement.correct, explanation: judgement.explanation, tip: judgement.tip, ...base, ...reveal } };
  }

  // Своё предложение: модель смотрит, верно ли употреблено слово (это и оценка), и правит остальное.
  if (dunno) {
    const conflict = await rate(false);
    if (conflict) return conflict;
    return { status: 200, body: { ok: true, ...reward, correct: false, ...reveal } };
  }
  const denied = await allowModelCheck(deps, user, "check");
  if (denied) return denied;
  let review;
  try {
    review = await deps.tutor.reviewSentence({ term: word.term, translation: word.translation, explanation: word.explanation, answer });
  } catch (err) {
    console.error("App sentence review failed", err);
    return { status: 200, body: { ok: true, ...reward, unchecked: true, ...reveal } };
  }
  const conflict = await rate(review.usesWord);
  if (conflict) return conflict;
  return { status: 200, body: { ok: true, ...reward, ...sentenceFeedback(deps, user, review), ...reveal } };
}

export function sentenceFeedback(deps: Deps, user: User, review: SentenceReview) {
  const real = review.fixes.filter((f) => !f.slip);
  // Как в /check: в работу над ошибками — только если человек согласится («Сохранить»).
  const mistakesId = real.length ? deps.pendingMistakes.create({ authorUserId: user.id, callerUserId: user.id, fixes: real, baseText: "" }) : undefined;
  return { correct: review.usesWord, verdict: review.verdict, corrected: review.corrected, fixes: review.fixes, natural: review.natural, mistakesId };
}

/** «Сохранить ошибки» под разбором своего предложения. */
export async function appSaveMistakes(deps: Deps, user: User, body: { id?: unknown; save?: unknown }): Promise<Result> {
  const pending = deps.pendingMistakes.peek(Number(body.id));
  if (!pending || pending.authorUserId !== user.id) return fail(404, "Это уже неактуально");
  deps.pendingMistakes.take(Number(body.id));
  if (body.save === true) await recordMistakes(deps.db, user.id, pending.fixes, deps.now());
  return { status: 200, body: { ok: true } };
}
