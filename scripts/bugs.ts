/**
 * Баги из /bug: описание, переписка вокруг и ошибки из логов.
 *   npx tsx scripts/bugs.ts                                   — открытые
 *   npx tsx scripts/bugs.ts --all-status=fixed
 *   npx tsx scripts/bugs.ts --close=12 --note="Что сделано"   — исправлен; автору уходит сообщение с итогом
 *   npx tsx scripts/bugs.ts --wontfix=12 --note="Почему так"  — не чиним (так задумано); автору — объяснение
 *   ... --silent                                              — закрыть без сообщения автору
 * Автору пишем в личку, а если бот не может ему писать — в чат, где был /bug.
 */
import { Api } from "grammy";
import { createDb } from "../src/db/client";
import { bugResolvedText, listBugs, resolveBug } from "../src/services/bugs";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const arg = (name: string) => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw?.slice(name.length + 3);
};
const close = arg("close");
const wontfix = arg("wontfix");
if (close || wontfix) {
  const status = close ? "fixed" : "wontfix";
  const note = arg("note")?.trim();
  if (!note && !process.argv.includes("--silent")) throw new Error("--note=\"…\" is required (what was done / why not) — it goes to the author; or --silent");
  const { bug, author } = await resolveBug(db, { id: Number(close ?? wontfix), status, resolution: note ?? "", now: new Date() });
  console.log(`#${bug.id} → ${status}`);
  if (!process.argv.includes("--silent")) {
    if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN in .env is needed to notify the author");
    const api = new Api(process.env.BOT_TOKEN);
    const chatId = author.canDm ? author.telegramId : bug.chatId;
    await api.sendMessage(chatId, bugResolvedText(bug), { parse_mode: "HTML" });
    console.log(`notified ${author.firstName} ${author.canDm ? "in DM" : `in chat ${bug.chatId}`}`);
  }
} else {
  const bugs = await listBugs(db, arg("all-status") ?? "open");
  if (bugs.length === 0) console.log("Открытых багов нет 🎉");
  for (const bug of bugs) {
    console.log(`\n════ #${bug.id} · ${bug.author} · ${bug.createdAt.toISOString().slice(0, 16)} · chat ${bug.chatId}`);
    console.log(`📝 ${bug.description}`);
    if (bug.resolution) console.log(`🔧 ${bug.resolution}`);
    if (bug.context.replied) console.log(`↩️ Ответ на:\n${bug.context.replied}`);
    console.log("— переписка —");
    for (const e of bug.context.transcript) console.log(`[${new Date(e.at).toISOString().slice(11, 19)}] ${e.from === "bot" ? "🤖" : `👤 ${e.name ?? ""}`}: ${e.text}`);
    if (bug.context.logs.length) console.log(`— логи —\n${bug.context.logs.join("\n")}`);
  }
}
