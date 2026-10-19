import { createDb } from "../../src/db/client";
import { ClaudeCodeEnricher } from "../../src/llm/claude-code";
import { buildDrillPrompt, parseDrill } from "../../src/llm/tutor";
import { mistakeProfile, recentMistakes } from "../../src/services/mistakes";

/** Генерирует вопросы по реальному профилю пользователя (по id в базе) и показывает сырой ответ, если разбор что-то отбросил. */
const userId = Number(process.argv[2] ?? 1);
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const profile = mistakeProfile(await recentMistakes(db, userId, new Date()));
console.log(`profile (${profile.total}):\n${profile.text}\n`);
const claude = new ClaudeCodeEnricher({ model: process.env.ENRICH_MODEL || "haiku", timeoutMs: 60_000 });
const started = Date.now();
const raw = await claude.ask(buildDrillPrompt(profile.text, 3), 60_000);
const parsed = parseDrill(raw);
console.log(`took ${Date.now() - started} ms, parsed ${parsed.length} question(s)`);
if (parsed.length < 3) console.log(`raw:\n${raw}`);
else for (const q of parsed) console.log(`- ${q.question} | ${q.options.join(" / ")} → ${q.options[q.correct]}`);
