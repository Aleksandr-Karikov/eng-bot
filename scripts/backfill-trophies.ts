/**
 * Засевает трофеи за уже прошедшие недели — чтобы коллекция не начиналась с пустой полки
 * у тех, кто реально добивал боссов до появления фичи.
 *
 *   npx tsx scripts/backfill-trophies.ts --dry-run   — только показать, ничего не писать
 *   npx tsx scripts/backfill-trophies.ts             — записать в базу
 *   npx tsx scripts/backfill-trophies.ts --weeks=6   — сколько недель назад смотреть (по умолчанию 8)
 *
 * Что восстанавливается точно: добил, больше всех, почти, с запасом, ночная птица, диктанты,
 * свои предложения, снайпер, железная неделя.
 *
 * Что НЕ восстанавливается и почему:
 * - «Пять шагов назад» и «Разобрался» — по логам не видно, когда слово уронили и когда тема закрылась;
 * - «Восставший» и «Помог другу» — нужны события, которых в базе не было;
 * - одноразовые мемные — намеренно не засеваем: «Пацифист» за давно прошедшую неделю — не подарок,
 *   а странность. Они начнут выдаваться с текущей недели.
 *
 * Скрипт идемпотентен: уникальный индекс (user, kind, week) не даст задвоить.
 */
import { createDb } from "../src/db/client";
import { rooms } from "../src/db/schema";
import { latestDigestMoment, WEEK_MS } from "../src/services/digest";
import { collectTrophies } from "../src/services/trophies";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const dryRun = process.argv.includes("--dry-run");
const weeksArg = process.argv.find((a) => a.startsWith("--weeks="))?.slice("--weeks=".length);
const weeks = Number(weeksArg ?? 8);
if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new Error("--weeks=1..52");

const now = new Date();
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const allRooms = await db.select().from(rooms);
console.log(`Rooms: ${allRooms.length}, weeks back: ${weeks}${dryRun ? " (dry run)" : ""}`);

let written = 0;
for (let back = weeks - 1; back >= 0; back--) {
  // Не подгоняем момент под одну границу: у каждой комнаты свой пояс, и collectTrophies сам возьмёт
  // последнее «воскресенье 20:00» по поясу комнаты, не позже этой точки.
  const moment = new Date(now.getTime() - back * WEEK_MS);
  const collected = await collectTrophies(db, moment, { dryRun, weeklyOnly: true });
  for (const { user, earned } of collected) {
    written += earned.length;
    if (dryRun) console.log(`  ${moment.toISOString().slice(0, 10)} ${user.firstName}: ${earned.map((t) => t.title).join(", ")}`);
  }
}

console.log(`${dryRun ? "[dry run] " : ""}trophies: ${written}`);
if (!dryRun) console.log("Готово. Коллекция в приложении: вкладка 🐉.");
