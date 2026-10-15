import type { Word } from "../db/schema";
import type { CheckResult } from "../llm/enricher";
import type { LeaderRow, PersonalStats } from "../services/stats";
import type { WordDraft } from "../services/words";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10, mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function formatDateTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function draftText(d: WordDraft): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  return text;
}

export function cardFront(word: Word): string {
  return `<b>${esc(word.term)}</b>\n\nВспомни перевод и нажми «Показать»`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b>\n\nЗнаешь это слово?`;
}

export function announceText(adderName: string, word: Word): string {
  return `📥 ${esc(adderName)} добавил(а) слово\n\n${draftText(word)}`;
}

export function reminderText(n: number): string {
  return `🔔 ${n} ${plural(n, "слово", "слова", "слов")} ${n % 10 === 1 && n % 100 !== 11 ? "ждёт" : "ждут"} повторения`;
}

export function doneText(reviewed: number, next: Date | undefined, timeZone: string): string {
  const head = reviewed > 0 ? `🎉 Готово! Повторено: ${reviewed}.` : "Сейчас нечего повторять 👌";
  return next ? `${head}\nСледующее повторение: ${formatDateTime(next, timeZone)}` : head;
}

export function statsText(s: PersonalStats, roomName?: string, board?: LeaderRow[]): string {
  const lines = [
    "📊 <b>Твой прогресс</b>",
    `Всего слов: ${s.total}`,
    `✅ Выучено: ${s.learned}`,
    `📖 В процессе: ${s.learning}`,
    `🆕 Новых: ${s.fresh}`,
    `🔁 Повторений за неделю: ${s.reviews7d}`,
    `🔥 Серия: ${s.streak} ${plural(s.streak, "день", "дня", "дней")}`,
  ];
  if (roomName && board?.length) {
    lines.push("", `🏠 <b>${esc(roomName)}</b> — за неделю`);
    board.forEach((r, i) => lines.push(`${i + 1}. ${esc(r.name)} — ${r.reviews7d} повт., ${r.learned} выуч.`));
  }
  return lines.join("\n");
}

const SUMMARY_MAX_TERMS = 15;

export function termsList(words: Array<{ term: string }>): string {
  const shown = words.slice(0, SUMMARY_MAX_TERMS).map((w) => `<b>${esc(w.term)}</b>`).join(", ");
  const rest = words.length - SUMMARY_MAX_TERMS;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

export function batchSummaryText(adderName: string, words: Array<{ term: string }>, roomName: string): string {
  const n = words.length;
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}» ${n} ${plural(n, "слово", "слова", "слов")}: ${termsList(words)}\n\nОни уже ждут в /learn`;
}

export function batchListText(n: number): string {
  return `🧺 Нашёл ${n} ${plural(n, "слово или фразу", "слова или фразы", "слов и фраз")}. Сними галочки с ненужного:`;
}

export function batchDoneText(words: Array<{ term: string }>): string {
  return words.length ? `✅ Добавлено: ${words.length} — ${termsList(words)}` : "Ничего не добавлено";
}

/** Экранирует текст и превращает **…** от модели в жирный. */
function boldMarked(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

export function checkText(r: CheckResult): string {
  const natural = r.natural ? `💬 <b>Естественнее:</b> ${esc(r.natural)}` : "";
  if (r.fixes.length === 0) return natural ? `👍 Ошибок нет\n\n${natural}` : "👍 Ошибок нет";
  const fixes = r.fixes.map((f) => `• <s>${esc(f.wrong)}</s> → <b>${esc(f.right)}</b>${f.why ? ` — ${esc(f.why)}` : ""}`);
  return [`✍️ <b>Исправлено:</b>\n${boldMarked(r.corrected)}`, fixes.join("\n"), natural].filter(Boolean).join("\n\n");
}

export function welcomeText(): string {
  return [
    "👋 Привет! Я помогаю учить английские слова вместе с друзьями.",
    "",
    "/room — твои комнаты и приглашения",
    "/newroom название — создать комнату",
    "/add слово — добавить слово (можно с переводом: bank — берег)",
    "/text текст или список — найду, что выучить, и добавлю пачкой",
    "/check — ответом на сообщение: проверю английский и подскажу, как естественнее",
    "/learn — повторить слова",
    "/stats — прогресс твой и друзей",
    "/settings — время напоминания",
    "/link — в группе: привязать её к комнате",
  ].join("\n");
}
