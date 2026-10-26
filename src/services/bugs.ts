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

/** Закрыть баг с итогом; вернуть, кому и куда о нём сообщить. */
export async function resolveBug(db: Db, input: { id: number; status: "fixed" | "wontfix"; resolution: string; now: Date }) {
  await db.update(bugReports).set({ status: input.status, resolution: input.resolution, resolvedAt: input.now }).where(eq(bugReports.id, input.id));
  const [row] = await db.select({ bug: bugReports, author: users }).from(bugReports).innerJoin(users, eq(bugReports.userId, users.id)).where(eq(bugReports.id, input.id));
  if (!row) throw new Error(`bug #${input.id} not found`);
  return { bug: row.bug, author: row.author };
}

/** Сообщение автору о закрытом баге: что он писал и что сделано. */
export function bugResolvedText(bug: { id: number; description: string; status: string; resolution: string | null }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const head = bug.status === "fixed" ? `✅ <b>Баг #${bug.id} исправлен</b>` : `ℹ️ <b>По багу #${bug.id}</b>`;
  const quote = bug.description.length > 300 ? `${bug.description.slice(0, 300)}…` : bug.description;
  return `${head}\n\nТы писал(а): <i>${esc(quote)}</i>${bug.resolution ? `\n\n${esc(bug.resolution)}` : ""}\n\nСпасибо, что сообщил(а)!`;
}

/** Сообщение владельцу о новом баге. */
export function newBugText(input: { id: number; author: string; where: string; description: string; replied?: string }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const replied = input.replied ? `\n↩️ Ответом на: <i>${esc(input.replied.slice(0, 300))}</i>` : "";
  return `🐞 <b>Новый баг #${input.id}</b> от ${esc(input.author)} (${esc(input.where)})\n\n${esc(input.description)}${replied}`;
}
