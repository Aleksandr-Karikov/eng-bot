import type { Word } from "../db/schema";
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

export function welcomeText(): string {
  return [
    "👋 Привет! Я помогаю учить английские слова вместе с друзьями.",
    "",
    "/room — твои комнаты и приглашения",
    "/newroom название — создать комнату",
    "/add слово — добавить слово (можно с переводом: bank — берег)",
    "/learn — повторить слова",
    "/stats — прогресс твой и друзей",
    "/settings — время напоминания",
    "/link — в группе: привязать её к комнате",
  ].join("\n");
}
