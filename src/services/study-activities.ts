import { and, countDistinct, eq, gte, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { reviewLogs, studyActivities, type User } from "../db/schema";
import { localMoment, localParts, nextDate } from "../time";
import { withCombatLock } from "./combat-ledger";
import { KNOW_STAGE } from "./goals";

type Player = Pick<User, "id" | "timezone">;
type Kind = typeof studyActivities.$inferSelect.kind;

const eventKey = (userId: number, day: string, kind: Kind, subject: string) =>
  JSON.stringify([userId, day, kind, subject]);

export async function recordStudyActivity(db: Db, player: Player, now: Date, kind: Kind, subject: string, energy: number) {
  const day = localParts(player.timezone, now).date;
  const [saved] = await db.insert(studyActivities).values({
    key: eventKey(player.id, day, kind, subject), userId: player.id, day, kind, energyDeci: energy * 10,
  }).onConflictDoNothing().returning({ key: studyActivities.key });
  return Boolean(saved);
}

const DAILY_TASKS = [
  { id: "cards", title: "Пройди 5 разных карточек", target: 5, reward: 10 },
  { id: "translate", title: "Верно переведи 3 предложения", target: 3, reward: 10 },
  { id: "explain", title: "Объясни 2 разных слова", target: 2, reward: 10 },
] as const;

export async function dailyTasks(db: Db, player: Player, now: Date, canClaim: boolean) {
  const day = localParts(player.timezone, now).date;
  const start = localMoment(player.timezone, day, "00:00");
  const end = localMoment(player.timezone, nextDate(day), "00:00");
  const [reviews, activities] = await Promise.all([
    db.select({ total: countDistinct(reviewLogs.cardId) }).from(reviewLogs).where(and(
      eq(reviewLogs.userId, player.id), gte(reviewLogs.reviewedAt, start), lt(reviewLogs.reviewedAt, end),
      or(isNull(reviewLogs.stage), ne(reviewLogs.stage, KNOW_STAGE)),
    )),
    db.select({ kind: studyActivities.kind, key: studyActivities.key }).from(studyActivities)
      .where(and(eq(studyActivities.userId, player.id), eq(studyActivities.day, day))),
  ]);
  const progress = {
    cards: reviews[0]?.total ?? 0,
    translate: activities.filter(({ kind }) => kind === "translate").length,
    explain: activities.filter(({ kind }) => kind === "explain").length,
  };
  return {
    day, canClaim,
    tasks: DAILY_TASKS.map((task) => ({
      ...task, progress: Math.min(task.target, progress[task.id]),
      claimed: activities.some(({ key }) => key === eventKey(player.id, day, "daily", task.id)),
    })),
  };
}

export function claimDailyTask(db: Db, player: Player, now: Date, id: unknown) {
  return withCombatLock(db, async () => {
    const state = await dailyTasks(db, player, now, true);
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.progress < task.target) return undefined;
    if (!task.claimed) await recordStudyActivity(db, player, now, "daily", task.id, task.reward);
    return dailyTasks(db, player, now, true);
  });
}

export type DailyTasksState = Awaited<ReturnType<typeof dailyTasks>>;
