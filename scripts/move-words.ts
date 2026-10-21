/**
 * Переносит слова, добавленные человеком в одну комнату, в другую — если добавил не туда.
 *   npx tsx scripts/move-words.ts --from=<roomId> --to=<roomId> --by=<userId> [--dry-run]
 * Карточки участников новой комнаты появляются как новые (у автора — сохраняются с прогрессом);
 * карточки тех, кого в новой комнате нет, удаляются вместе с их ответами. Перед запуском — бэкап базы.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { cards, reviewLogs, roomMembers, words } from "../src/db/schema";
import { createCards } from "../src/services/cards";

const arg = (name: string) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]);
const [from, to, by] = [arg("from"), arg("to"), arg("by")];
if (![from, to, by].every(Number.isInteger)) throw new Error("Usage: --from=<roomId> --to=<roomId> --by=<userId> [--dry-run]");
const dryRun = process.argv.includes("--dry-run");

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const moved = await db.select().from(words).where(and(eq(words.roomId, from), eq(words.addedBy, by)));
const ids = moved.map((w) => w.id);
const clash = ids.length
  ? await db.select({ term: words.term }).from(words).where(and(eq(words.roomId, to), inArray(words.termNormalized, moved.map((w) => w.termNormalized))))
  : [];
if (clash.length) throw new Error(`Already in the target room: ${clash.map((w) => w.term).join(", ")}`);
const members = (await db.select().from(roomMembers).where(eq(roomMembers.roomId, to))).map((m) => m.userId);
const drop = ids.length ? (await db.select().from(cards).where(inArray(cards.wordId, ids))).filter((c) => !members.includes(c.userId)).map((c) => c.id) : [];
console.log(`${ids.length} words: ${moved.map((w) => w.term).join(", ")}`);
console.log(`cards to drop (not in room ${to}): ${drop.length}; members of room ${to}: ${members.join(", ")}`);
if (dryRun || !ids.length) process.exit(0);
if (drop.length) {
  await db.delete(reviewLogs).where(inArray(reviewLogs.cardId, drop));
  await db.delete(cards).where(inArray(cards.id, drop));
}
await db.update(words).set({ roomId: to }).where(inArray(words.id, ids));
await createCards(db, members, ids, new Date());
console.log("Moved.");
