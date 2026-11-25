import { and, count, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs, type Word } from "../db/schema";
import type { DialogueScene, ExerciseTutor } from "../llm/tutor";

const FOCUSES = [
  "Подведи к частому словосочетанию из повседневной ситуации.",
  "Подведи к другой грамматической форме: например, расскажи о прошлом событии или о том, что меняется прямо сейчас.",
  "Дай повод попросить, предупредить о будущем или уточнить что-то вопросом. Подбери иное естественное соседство слов.",
] as const;

export async function prepareDialogue(db: Db, tutor: ExerciseTutor, cardId: number, word: Word): Promise<DialogueScene | undefined> {
  if (!tutor.dialogueScene) return undefined;
  const [reviewed] = await db.select({ total: count() }).from(reviewLogs)
    .where(and(eq(reviewLogs.cardId, cardId), inArray(reviewLogs.stage, ["sentence", "app_sentence"])));
  const focus = FOCUSES[(reviewed?.total ?? 0) % FOCUSES.length];
  const { term, translation, explanation } = word;
  return tutor.dialogueScene({ term, translation, explanation, focus });
}
