import type { ClozeSentence, User, Word } from "../db/schema";
import type { DrillQuestion, Judgement } from "../llm/tutor";
import { ALL_PARTS, type CardView } from "../services/card-view";
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

const withTranscription = (d: WordDraft, show = true) => {
  const line = show ? transcriptionLine(d) : "";
  return line ? `\n${line}` : "";
};

export function draftText(d: WordDraft): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}${withTranscription(d)}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  if (d.mnemonic) text += `\n\n💡 ${esc(d.mnemonic)}`;
  return text;
}

/** Карточка для /learn: слово видно, ответ спрятан под спойлер Telegram (тап — открыть). */
/** Карточка EN → RU. view — что показывать (настройка пользователя); запоминалка под спойлером, т.к. подсказывает ответ. */
export function cardText(word: WordDraft, view: CardView = ALL_PARTS): string {
  let answer = esc(word.translation);
  if (view.explanation && word.explanation) answer += `\n\n${esc(word.explanation)}`;
  if (view.example && word.example) answer += `\n\n<i>${esc(word.example)}</i>`;
  if (view.mnemonic && word.mnemonic) answer += `\n\n💡 ${esc(word.mnemonic)}`;
  return `<b>${esc(word.term)}</b>${withTranscription(word, view.transcription)}\n\n<tg-spoiler>${answer}</tg-spoiler>\n\nВспомни перевод, проверь себя тапом по скрытому и оцени:`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b> — <tg-spoiler>${esc(word.translation)}</tg-spoiler>${withTranscription(word)}\n\nЗнаешь это слово?`;
}

export function announceText(adderName: string, word: Word): string {
  return `📥 ${esc(adderName)} добавил(а) слово\n\n${draftText(word)}`;
}

export function reminderText(n: number, friend?: { name: string; reviews: number }): string {
  const base = `🔔 ${n} ${plural(n, "слово", "слова", "слов")} ${n % 10 === 1 && n % 100 !== 11 ? "ждёт" : "ждут"} повторения`;
  return friend ? `${base} · ${esc(friend.name)} сегодня уже повторил(а) ${friend.reviews} 🔥` : base;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function digestText(
  roomName: string,
  rows: Array<{ name: string; added: number; reviews7d: number; learned: number; streak: number }>,
  duels: Array<{ name: string; points: number }> = [],
): string {
  const lines = rows.map((r, i) => {
    const parts = [`${r.reviews7d} повт.`];
    if (r.added) parts.push(`+${r.added} ${plural(r.added, "слово", "слова", "слов")}`);
    parts.push(`выучено ${r.learned}`);
    if (r.streak) parts.push(`🔥 ${r.streak} ${plural(r.streak, "день", "дня", "дней")}`);
    return `${MEDALS[i] ?? "•"} <b>${esc(r.name)}</b> — ${parts.join(" · ")}`;
  });
  const hero = rows[0] && rows[0].reviews7d > 0 ? `\n\nГерой недели: <b>${esc(rows[0].name)}</b> 🎉` : "";
  const duelLine = duels.length ? `\n⚔️ Дуэли: ${duels.map((d) => `${esc(d.name)} ${d.points}`).join(" · ")}` : "";
  return `🏆 <b>Итоги недели</b> в «${esc(roomName)}»\n\n${lines.join("\n")}${duelLine}${hero}\n\nНовая неделя — новые слова: /learn`;
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
export function reverseCardText(word: WordDraft, view: CardView = ALL_PARTS): string {
  let answer = `<b>${esc(word.term)}</b>${withTranscription(word, view.transcription)}`;
  if (view.example && word.example) answer += `\n\n<i>${esc(word.example)}</i>`;
  if (view.mnemonic && word.mnemonic) answer += `\n\n💡 ${esc(word.mnemonic)}`;
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

const topicsOf = (categories: string[]) => [...new Set(categories.map((c) => c.trim()).filter(Boolean))].map(esc).join(", ");

/** Вопрос перед сохранением; name — чьи ошибки (undefined — свои). */
export function mistakesAskText(name: string | undefined, categories: string[]): string {
  const whose = name ? `ошибки ${esc(name)}` : "твои ошибки";
  const topics = topicsOf(categories);
  return `🧠 Сохранить ${whose} в работу над ошибками?${topics ? ` Темы: ${topics}` : ""}`;
}

export function mistakesSavedText(name: string | undefined, categories: string[]): string {
  const topics = topicsOf(categories);
  return `🧠 Сохранено ${name ? `для ${esc(name)}` : "для тебя"} в работу над ошибками${topics ? `: ${topics}` : ""}. Посмотреть — /mistakes`;
}

export function mistakesNotSavedText(name: string, botUsername: string): string {
  return `🧠 ${esc(name)} ещё не пользуется ботом — ошибки не сохранены. Открой https://t.me/${botUsername} и нажми Start, чтобы бот собирал частые ошибки и подбирал по ним упражнения.`;
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
    "",
    "🃏 Что показывать на карточке в /learn (перевод — всегда):",
  ].join("\n");
}

/** Экранирует текст и превращает **…** от модели в жирный. */
function boldMarked(s: string): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
}

/** С запасом под строчку «🧠 Сохранил…» — сообщение Telegram не длиннее 4096 символов. */
const CHECK_TEXT_LIMIT = 3800;

export function checkText(r: CheckResult): string {
  let natural = r.natural ? `💬 <b>Естественнее:</b> ${esc(r.natural)}` : "";
  if (r.fixes.length === 0) return natural ? `👍 Ошибок нет\n\n${natural}` : "👍 Ошибок нет";
  const all = r.fixes.map((f) => `• <s>${esc(f.wrong)}</s> → <b>${esc(f.right)}</b>${f.why ? ` — ${esc(f.why)}` : ""}`);
  const head = `✍️ <b>Исправлено:</b>\n${boldMarked(r.corrected)}`;
  let shown = all.length;
  const build = () => {
    const rest = all.length - shown;
    const fixes = all.slice(0, shown).join("\n") + (rest ? `\n…и ещё ${rest}` : "");
    return [head, fixes, natural].filter(Boolean).join("\n\n");
  };
  // Не влезает — сначала убираем «естественнее», потом сокращаем список ошибок.
  if (build().length > CHECK_TEXT_LIMIT) natural = "";
  while (build().length > CHECK_TEXT_LIMIT && shown > 1) shown--;
  return build();
}

export function welcomeText(): string {
  return [
    "👋 Привет! Я помогаю учить английские слова вместе с друзьями.",
    "",
    "/room — твои комнаты и приглашения",
    "/newroom название — создать комнату",
    "/add слово — добавить слово (можно с переводом: bank — берег)",
    "/text текст или список — найду, что выучить, и добавлю пачкой (можно ответом на сообщение)",
    "/check — ответом на сообщение: проверю английский и подскажу, как естественнее",
    "/edit кусок — исправить слово или фразу (без текста — список последних)",
    "/delete кусок — удалить слово или фразу (без текста — список последних)",
    "/learn — повторить слова",
    "/drill — вопросы по твоим частым ошибкам, /mistakes — что бот о них знает",
    "/stats — прогресс твой и друзей",
    "/settings — время напоминания",
    "/link — в группе: привязать её к комнате",
    "/duel — в группе: дуэль, кто быстрее переведёт слова",
  ].join("\n");
}

export function duelRoundText(round: number, total: number, term: string): string {
  return `⚔️ <b>Раунд ${round}/${total}</b>\n\nЧто значит <b>${esc(term)}</b>?\nКто первый ответит правильно — получает очко.`;
}

export function duelResultText(scores: Array<{ name: string; points: number }>): string {
  if (scores.length === 0) return "⚔️ <b>Итоги дуэли</b>\n\nНикто не набрал очков — реванш? /duel";
  const lines = scores.map((s, i) => `${MEDALS[i] ?? "•"} ${esc(s.name)} — ${s.points}`);
  return `⚔️ <b>Итоги дуэли</b>\n\n${lines.join("\n")}\n\n🏆 Победитель: <b>${esc(scores[0].name)}</b>! Реванш — /duel`;
}

export function wordOfDayText(word: WordDraft): string {
  const example = word.example ? `\n\n<i>${esc(word.example)}</i>` : "";
  return `☀️ <b>Слово дня</b>\n\n<b>${esc(word.term)}</b>${withTranscription(word)}\n<tg-spoiler>${esc(word.translation)}</tg-spoiler>${example}\n\nЗнаешь? Проверь себя тапом по скрытому 👆`;
}

/** Запоминалка подсказывает ответ — прячем под спойлер. */
export function mnemonicText(term: string, mnemonic: string): string {
  return `💡 <b>${esc(term)}</b>\n\n<tg-spoiler>${esc(mnemonic)}</tg-spoiler>`;
}

/** Подпись к картинке: слово и перевод под спойлером (лимит подписи в Telegram — 1024 символа). */
export function pictureCaption(term: string, translation: string): string {
  return `🖼 <b>${esc(term)}</b> — <tg-spoiler>${esc(translation.slice(0, 900))}</tg-spoiler>`;
}
