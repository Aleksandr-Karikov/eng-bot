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
import { TROPHY_BY_KIND, collectTrophies } from "../src/services/trophies";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const dryRun = process.argv.includes("--dry-run");
const weeksArg = process.argv.find((a) => a.startsWith("--weeks="))?.slice("--weeks=".length);
const weeks = Number(weeksArg ?? 8);
if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52) throw new Error("--weeks=1..52");

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const allRooms = await db.select().from(rooms);
console.log(`Rooms: ${allRooms.length}, weeks back: ${weeks}${dryRun ? " (dry run)" : ""}`);

/**
 * Одноразовые трофеи в прошлое не переносим. Список — по repeat в каталоге, а не по имени:
 * добавили новый мемный трофей — он автоматически не попадёт в засев.
 */
const backfillable = (kind: string) => TROPHY_BY_KIND.get(kind)?.repeat === "weekly";

let written = 0;
let skipped = 0;
for (let back = weeks; back >= 1; back--) {
  // Момент «воскресенье 20:00» той недели, за которую засеваем.
  const moment = new Date(latestDigestMoment(new Date(Date.now() - back * WEEK_MS)).at.getTime());
  const collected = await collectTrophies(db, moment);
  for (const { user, earned } of collected) {
    const keep = earned.filter((t) => backfillable(t.kind));
    skipped += earned.length - keep.length;
    if (keep.length === 0) continue;
    written += keep.length;
    if (dryRun) console.log(`  ${moment.toISOString().slice(0, 10)} ${user.firstName}: ${keep.map((t) => t.title).join(", ")}`);
  }
}

console.log(`${dryRun ? "[dry run] " : ""}trophies: ${written}, one-off skipped: ${skipped}`);
if (!dryRun) console.log("Готово. Коллекция в приложении: вкладка 🐉.");
