/**
 * Откуда приходят люди: источник → пришло → вернулось на 7-й день.
 *   npx tsx scripts/sources.ts
 * То же самое показывает /status в боте (только админу); скрипт нужен, чтобы смотреть чаще
 * и не открывать Telegram. Люди, пришедшие до миграции 0040, честно попадают в «неизвестно».
 */
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";
import { RETURN_DAYS, sourceLines, sourceSummary } from "../src/services/sources";

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const now = new Date();

const rows = await sourceSummary(db, now);
const all = await db.select().from(users);
const unknown = all.filter((u) => u.sourceAt == null).length;

console.log(`Всего людей: ${all.length}\n`);
for (const line of sourceLines(rows)) console.log("  " + line);
if (unknown > 0) console.log(`\nБез источника: ${unknown} — пришли до появления колонки, судить о них нечем.`);
console.log(`\n«Вернулся» = есть ответ на ${RETURN_DAYS}-й день после прихода или позже.`);
