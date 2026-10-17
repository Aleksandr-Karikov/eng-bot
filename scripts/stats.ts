/** Сводка по тренажёру за 30 дней (только чтение): npx tsx scripts/stats.ts */
import { createDb } from "../src/db/client";
import { trainerReport } from "../src/services/analytics";

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const r = await trainerReport(db, new Date());
const pct = (part: number, all: number) => (all ? `${Math.round((part / all) * 100)}%` : "—");
const NAMES: Record<string, string> = { en_ru: "EN → RU", ru_en: "RU → EN", cloze: "вставь по смыслу", know: "«Знаю» из уведомления" };

console.log("«Забыл» по ступеням (30 дней):");
for (const s of r.byStage) console.log(`  ${(NAMES[s.stage] ?? s.stage).padEnd(24)} ${String(s.answers).padStart(5)} ответов, забыл ${pct(s.forgot, s.answers)}`);
console.log(`\nНовые слова: при первом показе забыли ${r.firstShow.forgot} из ${r.firstShow.cards} (${pct(r.firstShow.forgot, r.firstShow.cards)})`);
console.log("\nТрудные слова:");
for (const w of r.hardWords) console.log(`  ${w.term} — забыли ${w.forgot} раз`);
console.log("\nКто сколько занимался:");
for (const p of r.people) console.log(`  ${p.name}: ${p.answers} ответов, забыл ${pct(p.forgot, p.answers)}`);
console.log("\nЧастые темы ошибок /check:");
for (const m of r.mistakeTopics) console.log(`  ${m.category} ×${m.count}`);
