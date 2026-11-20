/**
 * Переносит слова, добавленные человеком в одну комнату, в другую — если добавил не туда.
 *   npx tsx scripts/move-words.ts --from=<roomId> --to=<roomId> --by=<userId> [--dry-run]
 *
 * Слова, которые в целевой комнате уже есть, пропускаются: переносить нечего, а прогресс тех слов
 * может быть больше. Падать из-за них незачем — иначе одна пара совпадений блокирует весь перенос.
 *
 * Карточки участников новой комнаты появляются как новые (у автора — сохраняются с прогрессом);
 * карточки тех, кого в новой комнате нет, удаляются вместе с их ответами. Перед запуском — бэкап базы.
 */
import { and, eq, inArray } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { cards, reviewLogs, roomMembers, words } from "../src/db/schema";
import { createCards } from "../src/services/cards";
import { removeReviewHistory } from "../src/services/combat-ledger";

const arg = (name: string) => Number(process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]);
const [from, to, by] = [arg("from"), arg("to"), arg("by")];
if (![from, to, by].every(Number.isInteger)) throw new Error("Usage: --from=<roomId> --to=<roomId> --by=<userId> [--dry-run]");
const dryRun = process.argv.includes("--dry-run");

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const source = await db.select().from(words).where(and(eq(words.roomId, from), eq(words.addedBy, by)));

// Пропускаем то, что в целевой комнате уже есть: там своё слово со своим (возможно большим) прогрессом.
const taken = source.length
  ? new Set((await db.select({ term: words.termNormalized }).from(words).where(and(eq(words.roomId, to), inArray(words.termNormalized, source.map((w) => w.termNormalized)))))
      .map((w) => w.term))
  : new Set<string>();
const moved = source.filter((w) => !taken.has(w.termNormalized));
const skipped = source.filter((w) => taken.has(w.termNormalized));
const ids = moved.map((w) => w.id);

const members = (await db.select().from(roomMembers).where(eq(roomMembers.roomId, to))).map((m) => m.userId);
const drop = ids.length
  ? (await db.select().from(cards).where(inArray(cards.wordId, ids))).filter((c) => !members.includes(c.userId)).map((c) => c.id)
  : [];

console.log(`из комнаты ${from} в ${to}: переносим ${ids.length}, пропускаем ${skipped.length} (уже есть в целевой)`);
if (skipped.length) console.log(`  пропущено: ${skipped.map((w) => w.term).join(", ")}`);
console.log(`участники комнаты ${to}: ${members.join(", ")} → у них появится по ${ids.length} новых карточек`);
console.log(`карточек вне целевой комнаты (будут удалены с историей): ${drop.length}`);
if (dryRun || !ids.length) {
  if (dryRun) console.log("dry-run: ничего не изменено");
  process.exit(0);
}
if (drop.length) {
  await removeReviewHistory(db, inArray(reviewLogs.cardId, drop));
  await db.delete(cards).where(inArray(cards.id, drop));
}
await db.update(words).set({ roomId: to }).where(inArray(words.id, ids));
await createCards(db, members, ids, new Date());
console.log(`Перенесено ${ids.length} слов.`);
