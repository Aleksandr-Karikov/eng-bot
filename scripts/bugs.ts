/**
 * Баги из /bug: описание, переписка вокруг и ошибки из логов.
 *   npx tsx scripts/bugs.ts                 — открытые
 *   npx tsx scripts/bugs.ts --all-status=fixed
 *   npx tsx scripts/bugs.ts --close=12      — пометить исправленным (--wontfix=12 — не будем чинить)
 */
import { createDb } from "../src/db/client";
import { listBugs, setBugStatus } from "../src/services/bugs";

const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const close = arg("close");
const wontfix = arg("wontfix");
if (close || wontfix) {
  await setBugStatus(db, Number(close ?? wontfix), close ? "fixed" : "wontfix");
  console.log(`#${close ?? wontfix} → ${close ? "fixed" : "wontfix"}`);
} else {
  const bugs = await listBugs(db, arg("all-status") ?? "open");
  if (bugs.length === 0) console.log("Открытых багов нет 🎉");
  for (const bug of bugs) {
    console.log(`\n════ #${bug.id} · ${bug.author} · ${bug.createdAt.toISOString().slice(0, 16)} · chat ${bug.chatId}`);
    console.log(`📝 ${bug.description}`);
    if (bug.context.replied) console.log(`↩️ Ответ на:\n${bug.context.replied}`);
    console.log("— переписка —");
    for (const e of bug.context.transcript) console.log(`[${new Date(e.at).toISOString().slice(11, 19)}] ${e.from === "bot" ? "🤖" : `👤 ${e.name ?? ""}`}: ${e.text}`);
    if (bug.context.logs.length) console.log(`— логи —\n${bug.context.logs.join("\n")}`);
  }
}
