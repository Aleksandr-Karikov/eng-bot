import type { ClozeSentence, User, Word } from "../db/schema";
import type { DrillQuestion, Judgement } from "../llm/tutor";
import type { MistakeProfile } from "../services/mistakes";
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

const ipa = (s: string) => `/${s.trim().replace(/^[/[\]\s]+|[/[\]\s]+$/g, "")}/`;

/** «🇬🇧 /…/ · 🇺🇸 /…/», одна запись с двумя флагами, если они совпадают, или "" если транскрипции нет. */
export function transcriptionLine(d: { transcriptionUk?: string; transcriptionUs?: string }): string {
  const uk = d.transcriptionUk?.trim() ? ipa(d.transcriptionUk) : "";
  const us = d.transcriptionUs?.trim() ? ipa(d.transcriptionUs) : "";
  if (uk && uk === us) return `🇬🇧🇺🇸 ${esc(uk)}`;
  return [uk && `🇬🇧 ${esc(uk)}`, us && `🇺🇸 ${esc(us)}`].filter(Boolean).join(" · ");
}

const withTranscription = (d: WordDraft) => {
  const line = transcriptionLine(d);
  return line ? `\n${line}` : "";
};

export function draftText(d: WordDraft): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}${withTranscription(d)}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  return text;
}

/** Карточка для /learn: слово видно, ответ спрятан под спойлер Telegram (тап — открыть). */
export function cardText(word: WordDraft): string {
  let answer = esc(word.translation);
  if (word.explanation) answer += `\n\n${esc(word.explanation)}`;
  if (word.example) answer += `\n\n<i>${esc(word.example)}</i>`;
  return `<b>${esc(word.term)}</b>${withTranscription(word)}\n\n<tg-spoiler>${answer}</tg-spoiler>\n\nВспомни перевод, проверь себя тапом по скрытому и оцени:`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b> — <tg-spoiler>${esc(word.translation)}</tg-spoiler>${withTranscription(word)}\n\nЗнаешь это слово?`;
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

/** Ступень 2: русский перевод виден, английское слово с транскрипцией и примером — под спойлером. */
export function reverseCardText(word: WordDraft): string {
  let answer = `<b>${esc(word.term)}</b>${withTranscription(word)}`;
  if (word.example) answer += `\n\n<i>${esc(word.example)}</i>`;
  return `🇷🇺 <b>${esc(word.translation)}</b>\n\n<tg-spoiler>${answer}</tg-spoiler>\n\nВспомни по-английски, проверь себя тапом по скрытому и оцени:`;
}

/** Предложение с ответом на месте пропуска, ответ — жирным. */
export function clozeFull(s: Pick<ClozeSentence, "sentence" | "answer">): string {
  return esc(s.sentence).replace("___", `<b>${esc(s.answer)}</b>`);
}

export function clozeText(s: ClozeSentence): string {
  return `✍️ Вставь пропущенное слово или фразу:\n\n<i>${esc(s.sentence)}</i>\n\n🇷🇺 ${esc(s.translation)}\n\nНапиши ответ сообщением.`;
}

export function clozeCorrectText(s: ClozeSentence): string {
  return `✅ Верно!\n\n${clozeFull(s)}`;
}

export function clozeJudgedText(s: ClozeSentence, j: Judgement): string {
  const parts = [j.correct ? "✅ Засчитано" : "❌ Не то", clozeFull(s)];
  if (j.explanation) parts.push(esc(j.explanation));
  if (j.tip) parts.push(`💡 ${esc(j.tip)}`);
  return parts.join("\n\n");
}

export function clozeUnknownText(s: ClozeSentence): string {
  return `🤷 Правильно так:\n\n${clozeFull(s)}\n\n🇷🇺 ${esc(s.translation)}`;
}

export function drillQuestionText(q: DrillQuestion): string {
  const topic = q.category ? ` · <i>${esc(q.category)}</i>` : "";
  return `🧠 Работа над ошибками${topic}\n\n${esc(q.question)}\n\nВыбери вариант:`;
}

export function drillResultText(q: DrillQuestion, chosen: number): string {
  const verdict = chosen === q.correct ? "✅ Верно!" : `❌ Ты выбрал «${esc(q.options[chosen] ?? "")}»`;
  const filled = esc(q.question).replace("___", `<b>${esc(q.options[q.correct])}</b>`);
  return [verdict, filled, q.explanation ? esc(q.explanation) : ""].filter(Boolean).join("\n\n");
}

export function mistakesText(p: MistakeProfile): string {
  if (p.total === 0) return "🧠 Пока ошибок не записано. Их собирает /check — ответом на сообщение на английском.";
  const lines = p.categories.map((c) => {
    const example = c.examples[0] ? ` — <s>${esc(c.examples[0].wrong)}</s> → ${esc(c.examples[0].right)}` : "";
    return `• ${esc(c.category)} ×${c.count}${example}`;
  });
  return [`🧠 Твои частые ошибки (последние ${p.total}):`, ...lines, "", "По ним бот подбирает вопросы в /learn и /drill."].join("\n");
}

export function settingsText(user: User): string {
  return [
    `⏰ Напоминаю в ${user.reminderTime} (${user.timezone}). Выбери час или отправь /settings ЧЧ:ММ`,
    "",
    "🎯 Режимы тренажёра — по мере того как слово запоминается:",
    "1. EN → RU · 2. RU → EN · 3. Вставь по смыслу",
    "Выключенные пропускаются.",
  ].join("\n");
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
    "/edit кусок — исправить слово или фразу (без текста — список последних)",
    "/delete кусок — удалить слово или фразу (без текста — список последних)",
    "/learn — повторить слова",
    "/drill — вопросы по твоим частым ошибкам, /mistakes — что бот о них знает",
    "/stats — прогресс твой и друзей",
    "/settings — время напоминания",
    "/link — в группе: привязать её к комнате",
  ].join("\n");
}
