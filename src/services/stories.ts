import { and, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, stories, words, type Story } from "../db/schema";
import type { StoryDraft, StoryQuestion } from "../llm/tutor";

/** Сколько слов вплетать в одну историю: больше — текст становится натянутым. */
export const STORY_WORDS = 8;
/** Из скольких последних слов комнаты выбирать — чтобы истории подряд не повторялись. */
const CANDIDATES = 20;

export interface GlossaryItem {
  term: string;
  translation: string;
}

/**
 * Слова для истории: из последних слов комнаты, в случайном порядке.
 * Если история для одного человека — сначала те, что он забывал.
 */
export async function storyWords(db: Db, roomId: number, random: () => number, userId?: number): Promise<GlossaryItem[]> {
  const recent = await db
    .select({ id: words.id, term: words.term, translation: words.translation })
    .from(words)
    .where(eq(words.roomId, roomId))
    .orderBy(desc(words.createdAt), desc(words.id))
    .limit(CANDIDATES);
  const forgot = new Set<number>();
  if (userId !== undefined) {
    const rows = await db
      .select({ wordId: cards.wordId })
      .from(reviewLogs)
      .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
      .where(and(eq(reviewLogs.userId, userId), eq(reviewLogs.rating, "again")));
    for (const r of rows) forgot.add(r.wordId);
  }
  const shuffled = recent.map((w) => ({ w, key: random() })).sort((a, b) => a.key - b.key).map((x) => x.w);
  const ordered = [...shuffled.filter((w) => forgot.has(w.id)), ...shuffled.filter((w) => !forgot.has(w.id))];
  return ordered.slice(0, STORY_WORDS).map(({ term, translation }) => ({ term, translation }));
}

export async function saveStory(db: Db, roomId: number, draft: StoryDraft, glossary: GlossaryItem[], now: Date): Promise<Story> {
  const [story] = await db
    .insert(stories)
    .values({
      roomId,
      title: draft.title,
      body: draft.body,
      glossary: JSON.stringify(glossary),
      questions: JSON.stringify(draft.questions),
      createdAt: now,
    })
    .returning();
  return story;
}

export async function getStory(db: Db, id: number): Promise<Story | undefined> {
  const [story] = await db.select().from(stories).where(eq(stories.id, id));
  return story;
}

export async function setStoryAudio(db: Db, id: number, fileId: string): Promise<void> {
  await db.update(stories).set({ audioFileId: fileId }).where(eq(stories.id, id));
}

export const storyQuestions = (story: Story): StoryQuestion[] => JSON.parse(story.questions) as StoryQuestion[];
export const storyGlossary = (story: Story): GlossaryItem[] => JSON.parse(story.glossary) as GlossaryItem[];
