import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { bugReports, users } from "../db/schema";

export interface BugContext {
  /** Сообщение, на которое ответили /bug. */
  replied?: string;
  transcript: Array<{ at: number; from: "bot" | "user"; name?: string; text: string }>;
  logs: string[];
}

export async function saveBug(db: Db, input: { userId: number; chatId: number; description: string; context: BugContext; now: Date }): Promise<number> {
  const [row] = await db
    .insert(bugReports)
    .values({ userId: input.userId, chatId: input.chatId, description: input.description, context: JSON.stringify(input.context), createdAt: input.now })
    .returning({ id: bugReports.id });
  return row.id;
}

export async function listBugs(db: Db, status = "open") {
  const rows = await db
    .select({ bug: bugReports, author: users.firstName })
    .from(bugReports)
    .innerJoin(users, eq(bugReports.userId, users.id))
    .where(eq(bugReports.status, status))
    .orderBy(desc(bugReports.id));
  return rows.map((r) => ({ ...r.bug, author: r.author, context: JSON.parse(r.bug.context) as BugContext }));
}

export async function setBugStatus(db: Db, id: number, status: "open" | "fixed" | "wontfix"): Promise<void> {
  await db.update(bugReports).set({ status }).where(eq(bugReports.id, id));
}
