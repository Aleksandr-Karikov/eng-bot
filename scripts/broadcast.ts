/**
 * Рассылает HTML-сообщение из файла всем, кому бот может писать в личку.
 *   npx tsx scripts/broadcast.ts release-notes/2026-10-17.html --dry-run   — только показать
 *   npx tsx scripts/broadcast.ts release-notes/2026-10-17.html             — отправить
 *   ... --only=AleksandrKarikov                                            — только одному (username без @)
 */
import { readFileSync } from "node:fs";
import { Api } from "grammy";
import { eq } from "drizzle-orm";
import { createDb } from "../src/db/client";
import { users } from "../src/db/schema";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен
}

const [file] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice("--only=".length).replace(/^@/, "");
if (!file || !process.env.BOT_TOKEN) throw new Error("usage: broadcast.ts <file.html> [--dry-run], BOT_TOKEN in .env");

const text = readFileSync(file, "utf8").trim();
const db = createDb(process.env.DB_PATH || "data/eng-bot.sqlite", { migrate: false });
const recipients = (await db.select().from(users).where(eq(users.canDm, true))).filter(
  (u) => !only || u.username === only || String(u.telegramId) === only,
);
if (recipients.length === 0) throw new Error(`No recipients${only ? ` matching ${only}` : ""}`);
console.log(`${dryRun ? "[dry run] " : ""}${text.length} chars → ${recipients.map((u) => u.firstName).join(", ")}`);

const api = new Api(process.env.BOT_TOKEN);
for (const user of recipients) {
  if (dryRun) continue;
  try {
    await api.sendMessage(user.telegramId, text, { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    console.log(`sent: ${user.firstName}`);
  } catch (err) {
    console.error(`failed: ${user.firstName}`, (err as Error).message);
  }
}
