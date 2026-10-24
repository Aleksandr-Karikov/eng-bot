import { termPattern } from "../services/word-uses";
import type { ClozeSentence, Story, User, Word } from "../db/schema";
import type { Collocations, DrillQuestion, Judgement, LeechHelp, SayAnswer, SentenceReview, TalkReview, TranslationReview } from "../llm/tutor";
import { ALL_PARTS, type CardView } from "../services/card-view";
import { RESOLVE_STREAK, type DrillProgress, type MistakeProfile } from "../services/mistakes";
import type { GoalProgress } from "../services/goals";
import type { WeeklyReport } from "../services/weekly-report";
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


/** Сочетания на карточке; collocations — JSON из базы. */
/** Сочетаний на карточке — не больше трёх, по одному в строке: длинная строка через «·» читалась плохо. */
const CARD_COLLOCATIONS = 3;

function collocationsLine(collocations: string): string {
  const c = JSON.parse(collocations) as Collocations;
  return c.items.length ? `\n\n<b>Сочетания:</b>\n${c.items.slice(0, CARD_COLLOCATIONS).map((i) => `• ${esc(i.phrase)}`).join("\n")}` : "";
}

/** Кружок полезности рядом со словом на карточке — без подписи; пояснение — только в черновике при добавлении. */
const usefulnessIcon = (d: { usefulness?: number | null }) => (d.usefulness ? ` ${{ 3: "🟢", 2: "🟡", 1: "⚪️" }[d.usefulness] ?? ""}` : "");

/** «📍 …» — исходное предложение, само слово в нём жирным. */
/** Реплика, где встретилось слово; само слово в ней — жирным. */
function markedContext(context: string, term: string): string {
  const match = termPattern(term).exec(context.toLowerCase().replace(/[’‘`]/g, "'"));
  return match
    ? `${esc(context.slice(0, match.index))}<b>${esc(context.slice(match.index, match.index + match[0].length))}</b>${esc(context.slice(match.index + match[0].length))}`
    : esc(context);
}

/** «📍 …» — для сообщений о добавленном слове. */
export function contextLine(context: string, term: string): string {
  return `📍 <i>${markedContext(context, term)}</i>`;
}

/** Блок «Где встретилось» на карточке: исходная реплика и (если есть) ещё одна, самая свежая. */
function contextBlock(word: { term: string; context?: string; moreContexts?: string }): string {
  if (!word.context) return "";
  const [latest] = JSON.parse(word.moreContexts || "[]") as Array<{ text: string; title: string }>;
  const lines = [`<i>${markedContext(word.context, word.term)}</i>`];
  if (latest) lines.push(`<i>${markedContext(latest.text, word.term)}</i>${latest.title ? ` (${esc(latest.title)})` : ""}`);
  return `\n\n<b>Где встретилось:</b>\n${lines.join("\n")}`;
}

const USEFULNESS_LABELS: Record<number, string> = {
  3: "🟢 Очень полезное",
  2: "🟡 Полезное",
  1: "⚪️ Необязательное — учим только на узнавание",
};

/** «🟢 Очень полезное — частое в разговоре»; "" — не оценено. */
export function usefulnessLine(d: { usefulness?: number | null; usefulnessNote?: string }): string {
  const label = d.usefulness ? USEFULNESS_LABELS[d.usefulness] : undefined;
  if (!label) return "";
  return d.usefulnessNote ? `${label}: ${esc(d.usefulnessNote)}` : label;
}

export function draftText(d: WordDraft): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}${withTranscription(d)}`;
  const useful = usefulnessLine(d);
  if (useful) text += `\n${useful}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  if (d.context) text += `\n\n${contextLine(d.context, d.term)}`;
  if (d.mnemonic) text += `\n\n💡 ${esc(d.mnemonic)}`;
  return text;
}

/** Карточка для /learn: слово видно, ответ спрятан под спойлер Telegram (тап — открыть). */
/** Карточка EN → RU. view — что показывать (настройка пользователя); запоминалка под спойлером, т.к. подсказывает ответ. */
/**
 * Подробности — в свёрнутой цитате: основной ответ остаётся коротким, остальное раскрывается по тапу.
 * Внутри тоже спойлер — иначе первые строки свёрнутого блока подсказывали бы ответ до проверки.
 */
function cardDetails(word: WordDraft & { collocations?: string; moreContexts?: string }, view: CardView, withExplanation: boolean): string {
  let text = "";
  if (withExplanation && view.explanation && word.explanation) text += `\n\n${esc(word.explanation)}`;
  if (view.example && word.example) text += `\n\n<b>Пример:</b> <i>${esc(word.example)}</i>`;
  if (view.context) text += contextBlock(word);
  if (view.collocations && word.collocations) text += collocationsLine(word.collocations);
  if (view.mnemonic && word.mnemonic) text += `\n\n<b>Как запомнить:</b> ${esc(word.mnemonic)}`;
  const body = text.replace(/^\n\n/, "");
  return body ? `\n\n<blockquote expandable><tg-spoiler>${body}</tg-spoiler></blockquote>` : "";
}

export function cardText(word: WordDraft & { collocations?: string; moreContexts?: string }, view: CardView = ALL_PARTS): string {
  const answer = `<tg-spoiler><b>${esc(word.translation)}</b></tg-spoiler>`;
  return `<b>${esc(word.term)}</b>${usefulnessIcon(word)}${withTranscription(word, view.transcription)}\n\n${answer}${cardDetails(word, view, true)}\n\nВспомни перевод и проверь себя тапом:`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b> — <tg-spoiler>${esc(word.translation)}</tg-spoiler>${withTranscription(word)}\n\nЗнаешь это слово?`;
}

export function announceText(adderName: string, word: Word): string {
  return `📥 ${esc(adderName)} добавил(а) слово\n\n${draftText(word)}`;
}

/** due — число к повторению или по отдельности: к повторению и новые. */
export function reminderText(due: number | { review: number; fresh: number }, friend?: { name: string; reviews: number }): string {
  const { review, fresh } = typeof due === "number" ? { review: due, fresh: 0 } : due;
  const waits = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "ждёт" : "ждут");
  const newWords = `${fresh} ${plural(fresh, "новое слово", "новых слова", "новых слов")}`;
  const base = review
    ? `🔔 ${review} ${plural(review, "слово", "слова", "слов")} ${waits(review)} повторения${fresh ? ` + ${newWords}` : ""}`
    : `🆕 ${newWords} ${waits(fresh)} знакомства`;
  return friend ? `${base} · ${esc(friend.name)} сегодня уже повторил(а) ${friend.reviews} 🔥` : base;
}

export function dueNoticeText(n: number): string {
  return `🔔 Снова появились слова для повторения: ${n} ${plural(n, "слово", "слова", "слов")}. Самое время!`;
}

const MEDALS = ["🥇", "🥈", "🥉"];

export function digestText(
  roomName: string,
  rows: Array<{ name: string; added: number; reviews7d: number; learned: number; streak: number; used?: number }>,
  duels: Array<{ name: string; points: number }> = [],
  goal?: GoalProgress,
): string {
  const lines = rows.map((r, i) => {
    const parts = [`${r.reviews7d} повт.`];
    if (r.added) parts.push(`+${r.added} ${plural(r.added, "слово", "слова", "слов")}`);
    parts.push(`выучено ${r.learned}`);
    if (r.used) parts.push(`👏 ${r.used} в разговоре`);
    if (r.streak) parts.push(`🔥 ${r.streak} ${plural(r.streak, "день", "дня", "дней")}`);
    return `${MEDALS[i] ?? "•"} <b>${esc(r.name)}</b> — ${parts.join(" · ")}`;
  });
  const hero = rows[0] && rows[0].reviews7d > 0 ? `\n\nГерой недели: <b>${esc(rows[0].name)}</b> 🎉` : "";
  const duelLine = duels.length ? `\n⚔️ Дуэли: ${duels.map((d) => `${esc(d.name)} ${d.points}`).join(" · ")}` : "";
  const goalLine = goal ? `\n🎯 Цель недели: ${goal.done}/${goal.target} ${goal.done >= goal.target ? "✅" : "— в этот раз не дотянули"}` : "";
  return `🏆 <b>Итоги недели</b> в «${esc(roomName)}»\n\n${lines.join("\n")}${duelLine}${goalLine}${hero}\n\nНовая неделя — новые слова: /learn`;
}

const progressBar = (done: number, target: number) => {
  const filled = Math.min(10, Math.floor((done / Math.max(1, target)) * 10));
  return "▓".repeat(filled) + "░".repeat(10 - filled);
};

export function weeklyReportText(r: WeeklyReport): string {
  const trend =
    r.reviewsBefore === 0 ? "" : r.reviews >= r.reviewsBefore ? ` (📈 +${r.reviews - r.reviewsBefore} к прошлой)` : ` (📉 ${r.reviews - r.reviewsBefore} к прошлой)`;
  const lines = [
    "📬 <b>Твоя неделя</b>",
    "",
    `🔁 Повторений: ${r.reviews}${trend}`,
    `🎯 Вспомнил с первого раза: ${r.accuracy}%`,
  ];
  if (r.started) lines.push(`🆕 Начал учить: ${r.started} ${plural(r.started, "слово", "слова", "слов")}`);
  lines.push(`✅ Выучено всего: ${r.learned}`);
  if (r.streak) lines.push(`🔥 Серия: ${r.streak} ${plural(r.streak, "день", "дня", "дней")}`);
  if (r.usedInChat) lines.push(`👏 Употребил в разговоре: ${r.usedInChat}`);
  if (r.hardest.length) lines.push("", `😵 Чаще всего забывал: ${r.hardest.map((h) => `<b>${esc(h.term)}</b> ×${h.forgot}`).join(", ")}`);
  if (r.resolvedTopics.length) lines.push(`🧠 Отработал темы: ${r.resolvedTopics.map(esc).join(", ")}`);
  lines.push("", "Новая неделя — /learn. Отключить итог — /settings");
  return lines.join("\n");
}

export function goalText(roomName: string, g: GoalProgress): string {
  const percent = Math.round((g.done / Math.max(1, g.target)) * 100);
  const lines = [
    `🎯 <b>Цель «${esc(roomName)}» на неделю</b>: ${g.done}/${g.target} повторений${g.done >= g.target ? " ✅" : ""}`,
    `${progressBar(g.done, g.target)} ${percent}%`,
  ];
  if (g.byUser.length) lines.push(`Вклад: ${g.byUser.map((u) => `${esc(u.name)} ${u.count}`).join(" · ")}`);
  lines.push(
    "",
    g.auto ? "Цель подобрана по прошлой неделе (+10%). Своя — /goal 300" : "Вернуть автоцель — /goal auto",
    "Неделя заканчивается в воскресенье в 20:00.",
  );
  return lines.join("\n");
}

export function goalReachedText(roomName: string, g: GoalProgress): string {
  const top = g.byUser[0] ? ` Больше всех — ${esc(g.byUser[0].name)} (${g.byUser[0].count})` : "";
  return `🎯🎉 «${esc(roomName)}» выполнила цель недели: ${g.done}/${g.target} повторений!${top}`;
}

export function doneText(reviewed: number, next: Date | undefined, timeZone: string): string {
  const head = reviewed > 0 ? `🎉 Готово! Повторено: ${reviewed}.` : "Сейчас нечего повторять 👌";
  return next ? `${head}\nСледующее повторение: ${formatDateTime(next, timeZone)}` : head;
}

export function statsText(s: PersonalStats, roomName?: string, board?: LeaderRow[], goal?: GoalProgress): string {
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
  if (goal) lines.push("", `🎯 Цель недели: ${goal.done}/${goal.target} ${progressBar(goal.done, goal.target)} — /goal`);
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
export function reverseCardText(word: WordDraft & { collocations?: string; moreContexts?: string }, view: CardView = ALL_PARTS): string {
  const answer = `<tg-spoiler><b>${esc(word.term)}</b>${withTranscription(word, view.transcription)}</tg-spoiler>`;
  return `🇷🇺 <b>${esc(word.translation)}</b>${usefulnessIcon(word)}\n\n${answer}${cardDetails(word, view, false)}\n\nВспомни по-английски и проверь себя тапом:`;
}

/**
 * Подставляет ответ в пропуск, ответ — жирным. Модель иногда кладёт в вариант и соседнее слово
 * («We need ___ gold» + «the gold»): повторяющиеся на стыке слова убираем, иначе выходит «the gold gold».
 */
export function fillGap(sentence: string, answer: string): string {
  const { before, after } = gapParts(sentence, answer);
  return `${esc(before)}<b>${esc(answer)}</b>${esc(after)}`;
}

/** То же без разметки: что до пропуска и что после (повтор на стыке уже убран) — приложение рисует ответ само. */
export function gapParts(sentence: string, answer: string): { before: string; answer: string; after: string } {
  const [before = "", ...rest] = sentence.split("___");
  const words = answer.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const WORD = /^[\p{L}\p{N}'’]+/u;
  const WORD_END = /[\p{L}\p{N}'’]+$/u;
  /** Срезает k слов ответа с начала текста после пропуска, если они там повторены; иначе — как было. */
  const cutAfter = (text: string, k: number) => {
    let left = text;
    for (const w of words.slice(-k)) {
      left = left.replace(/^\s+/, "");
      const m = WORD.exec(left);
      if (!m || m[0].toLowerCase() !== w) return undefined;
      left = left.slice(m[0].length);
    }
    return left;
  };
  const cutBefore = (text: string, k: number) => {
    let left = text;
    for (const w of words.slice(0, k).reverse()) {
      left = left.replace(/\s+$/, "");
      const m = WORD_END.exec(left);
      if (!m || m[0].toLowerCase() !== w) return undefined;
      left = left.slice(0, -m[0].length);
    }
    return left;
  };
  let after = rest.join("___");
  let head = before;
  for (let k = Math.min(words.length, 4); k > 0; k--) {
    const cut = cutAfter(after, k);
    if (cut !== undefined) {
      after = cut;
      break;
    }
  }
  for (let k = Math.min(words.length, 4); k > 0; k--) {
    const cut = cutBefore(head, k);
    if (cut !== undefined) {
      head = cut.replace(/\s*$/, cut.trim() ? " " : "");
      break;
    }
  }
  return { before: head, answer, after };
}

/** Предложение с ответом на месте пропуска, ответ — жирным. */
export function clozeFull(s: Pick<ClozeSentence, "sentence" | "answer">): string {
  return fillGap(s.sentence, s.answer);
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

export function sentenceTaskText(word: Pick<Word, "term" | "translation">): string {
  return `✍️ Составь своё предложение со словом:\n\n<b>${esc(word.term)}</b> — ${esc(word.translation)}\n\nНапиши его сообщением — проверю, верно ли употреблено слово, и поправлю ошибки.`;
}

export function sentenceReviewText(r: SentenceReview, word: Pick<Word, "example">): string {
  const parts = [r.usesWord ? "✅ Слово употреблено верно" : "❌ Слово употреблено неверно"];
  if (r.verdict) parts.push(esc(r.verdict));
  if (r.fixes.length || r.natural) parts.push(checkText(r));
  if (!r.usesWord && word.example) parts.push(`Пример: <i>${esc(word.example)}</i>`);
  return parts.join("\n\n");
}

export const LISTEN_TASK_TEXT = "🎧 Диктант: послушай и напиши сообщением, что услышал.";

/** Ответ на диктант или «не знаю» в нём: слово, транскрипция и перевод. */
export function dictationText(grade: "exact" | "close" | "wrong" | "unknown", word: Word, answer = ""): string {
  const reveal = `<b>${esc(word.term)}</b> — ${esc(word.translation)}${withTranscription(word)}`;
  if (grade === "exact") return `✅ Верно!\n\n${reveal}`;
  if (grade === "close") return `✅ Почти! Правильно пишется так:\n\n${reveal}`;
  if (grade === "unknown") return `🤷 Это было:\n\n${reveal}`;
  return `❌ Это было:\n\n${reveal}\n\nТы написал: <s>${esc(answer)}</s>`;
}

/** «Не знаю» в «своём предложении»: слово и пример, как его употребляют. */
export function sentenceUnknownText(word: Word): string {
  const example = word.example ? `\n\nПример: <i>${esc(word.example)}</i>` : "";
  return `🤷 <b>${esc(word.term)}</b> — ${esc(word.translation)}${example}`;
}

export function drillQuestionText(q: DrillQuestion): string {
  const topic = q.category ? ` · <i>${esc(q.category)}</i>` : "";
  return `🧠 Работа над ошибками${topic}\n\n${esc(q.question)}\n\nВыбери вариант:`;
}

export function drillResultText(q: DrillQuestion, chosen: number, progress?: DrillProgress): string {
  const verdict = chosen === q.correct ? "✅ Верно!" : `❌ Ты выбрал «${esc(q.options[chosen] ?? "")}»`;
  const filled = fillGap(q.question, q.options[q.correct] ?? "");
  return [verdict, filled, q.explanation ? esc(q.explanation) : "", progress ? drillProgressText(progress) : ""].filter(Boolean).join("\n\n");
}

export function drillProgressText(p: DrillProgress): string {
  const topic = `«${esc(p.category)}»`;
  if (p.resolved) return `🎉 Тема ${topic} отработана — больше её не предлагаю. Новая ошибка в ней из /check вернёт тему.`;
  if (p.streak === 0) return `🧠 Тема ${topic}: счёт заново — нужно ${RESOLVE_STREAK} верных ответа подряд.`;
  return `🧠 Тема ${topic}: ${p.streak}/${RESOLVE_STREAK} верных подряд.`;
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

export function mistakesText(p: MistakeProfile, resolved: Map<string, number> = new Map()): string {
  const done = resolved.size ? `✅ Отработано: ${[...resolved.keys()].map(esc).join(", ")}` : "";
  if (p.total === 0) {
    return done ? `🎉 Все темы отработаны!\n\n${done}` : "🧠 Пока ошибок не записано. Их собирает /check — ответом на сообщение на английском.";
  }
  const lines = p.categories.map((c) => {
    const example = c.examples[0] ? ` — <s>${esc(c.examples[0].wrong)}</s> → ${esc(c.examples[0].right)}` : "";
    return `• ${esc(c.category)} ×${c.count}${example}`;
  });
  return [
    `🧠 Над чем работаем (ошибок: ${p.total}):`,
    ...lines,
    ...(done ? ["", done] : []),
    "",
    `По ним бот подбирает вопросы в /learn и /drill. Тема закрывается после ${RESOLVE_STREAK} верных ответов подряд.`,
  ].join("\n");
}

export function settingsText(user: User, screen: "main" | "remind" | "modes" | "card" = "main"): string {
  if (screen === "remind") return `⏰ Напоминаю в ${user.reminderTime} (${user.timezone}). Выбери час или отправь /settings ЧЧ:ММ`;
  if (screen === "modes") return "🎯 Упражнения в /learn — каждая карточка приходит в случайном из включённых (новое слово — сначала EN → RU):";
  if (screen === "card") return "🃏 Что показывать на карточке в /learn (перевод — всегда):";
  return `⚙️ Настройки\n\n⏰ Напоминание в ${user.reminderTime}`;
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

export function leechText(word: Pick<Word, "term" | "translation">, help: LeechHelp, forgot: number): string {
  const parts = [`🧩 <b>${esc(word.term)}</b> (${esc(word.translation)}) никак не даётся: забыто уже ${forgot} ${plural(forgot, "раз", "раза", "раз")}. Давай разберёмся.`];
  if (help.why) parts.push(`🤔 ${esc(help.why)}`);
  if (help.contrast.length) parts.push(`⚖️ <b>Не путать:</b>\n${help.contrast.map((c) => `• ${esc(c)}`).join("\n")}`);
  if (help.examples.length) parts.push(`📝 ${help.examples.map((e) => `• ${boldMarked(e)}`).join("\n")}`);
  if (help.tip) parts.push(`💡 ${esc(help.tip)}`);
  return parts.join("\n\n");
}

export function collocationQuizText(quiz: NonNullable<Collocations["quiz"]>, term: string): string {
  return `🔗 Какое слово подходит к <b>${esc(term)}</b>?\n\n<i>${esc(quiz.question)}</i>`;
}

const collocationList = (c: Collocations) => c.items.map((i) => `• ${esc(i.phrase)} — ${esc(i.translation)}`).join("\n");

export function collocationResultText(c: Collocations, chosen: number): string {
  const quiz = c.quiz!;
  const verdict = chosen === quiz.correct ? "✅ Верно!" : `❌ Не «${esc(quiz.options[chosen] ?? "")}»`;
  const filled = fillGap(quiz.question, quiz.options[quiz.correct] ?? "");
  const parts = [verdict, filled];
  if (quiz.explanation) parts.push(esc(quiz.explanation));
  if (c.items.length) parts.push(`🔗 <b>Сочетания:</b>\n${collocationList(c)}`);
  return parts.join("\n\n");
}

/** Слова, добавленные из расширения: что добавилось и откуда. */
export function captureText(words: Array<Pick<Word, "term" | "translation" | "context">>, title: string, duplicates: string[] = []): string {
  const lines = words.map((w) => `➕ <b>${esc(w.term)}</b> — ${esc(w.translation)}`);
  const context = words[0]?.context ? `\n${contextLine(words[0].context, words[0].term)}` : "";
  const source = title ? `\n🎬 <i>${esc(title)}</i>` : "";
  const dupes = duplicates.length ? `\n\nУже были: ${duplicates.map(esc).join(", ")}` : "";
  return `${lines.join("\n")}${context}${source}${dupes}`;
}

/** server — адрес, который вставить в настройки расширения (публичный через ngrok или localhost). */
export function extensionText(key: string, server: string): string {
  return [
    "🧩 <b>Расширение для субтитров</b>",
    "",
    "Смотришь сериал на inoriginal.cc в Chrome — кликаешь слово или фразу в субтитрах, и оно сразу в боте, с репликой как контекстом.",
    "",
    "<b>На любом сайте:</b>",
    "• иконка расширения или <code>Alt+Shift+S</code> — обведи рамкой текст, картинку или кадр видео, и текст появится в панели;",
    "• выдели текст → правый клик → «➕ В WordBoss».",
    "Слова можно добавлять подряд, не дожидаясь, — внизу панели видно, что готово.",
    "",
    "<b>Как поставить:</b>",
    "1. Chrome → chrome://extensions → включи «Режим разработчика».",
    "2. Нажми «📦 Скачать расширение» ниже, распакуй архив → «Загрузить распакованное» → выбери папку wordboss.",
    "Ключ и адрес уже вписаны в архив. Если ставил расширение раньше — проверь в его настройках:",
    `Ключ: <code>${esc(key)}</code>`,
    `Адрес: <code>${esc(server)}</code>`,
    "",
    "Ключ личный — по нему бот понимает, что слово твоё. Никому его не пересылай.",
  ].join("\n");
}

export function translateTaskText(ru: string): string {
  return `🇷🇺 <b>${esc(ru)}</b>\n\nПереведи на английский:`;
}

export function translateResultText(task: { en: string; word: string }, r: TranslationReview, progress: DrillProgress | undefined, saved: boolean): string {
  const parts = [r.correct ? "✅ Верно!" : "❌ Есть ошибки"];
  if (r.verdict) parts.push(esc(r.verdict));
  if (r.fixes.length || r.natural) parts.push(checkText(r));
  if (!r.correct && !r.natural) parts.push(`Можно так: <i>${esc(task.en)}</i>`);
  if (task.word && r.usedWord) parts.push(`📚 <b>${esc(task.word)}</b> — засчитано как повторение`);
  else if (task.word) parts.push(`📚 Здесь просилось <b>${esc(task.word)}</b>`);
  if (progress) parts.push(drillProgressText(progress));
  if (saved) parts.push("🧠 Ошибки сохранены в работу над ошибками — /mistakes");
  return parts.join("\n\n");
}

export function translateDoneText(done: number, correct: number): string {
  return done ? `🏁 Готово: ${done} ${plural(done, "предложение", "предложения", "предложений")}, верно — ${correct}. Ещё — /translate` : "Ок, в другой раз 👋 /translate";
}

export function sayText(phrase: string, answer: SayAnswer): string {
  const variants = answer.variants.map((v) => {
    const meta = [v.register, v.note].filter(Boolean).map(esc).join(" — ");
    return `• <b>${esc(v.text)}</b>${meta ? `\n  <i>${meta}</i>` : ""}`;
  });
  const learn = answer.learn.length
    ? `\n\n📚 Стоит запомнить:\n${answer.learn.map((l) => `• ${esc(l.term)} — ${esc(l.translation)}`).join("\n")}`
    : "";
  return `🇬🇧 Как сказать «${esc(phrase)}»:\n\n${variants.join("\n")}${learn}`;
}

export function talkReviewText(r: TalkReview, words: Array<{ term: string }>): string {
  const parts = ["🏁 <b>Разбор разговора</b>"];
  if (r.praise) parts.push(`👍 ${esc(r.praise)}`);
  const fixes = r.fixes.map((f) => `• <s>${esc(f.wrong)}</s> → <b>${esc(f.right)}</b>${f.slip ? " (описка)" : f.why ? ` — ${esc(f.why)}` : ""}`);
  parts.push(fixes.length ? `✍️ <b>Ошибки:</b>\n${fixes.join("\n")}` : "✍️ Ошибок не нашёл 🎉");
  if (r.natural.length) parts.push(`💬 <b>Естественнее:</b>\n${r.natural.map((n) => `• ${esc(n.original)} → <i>${esc(n.better)}</i>`).join("\n")}`);
  const used = new Set(r.usedWords.map((w) => w.toLowerCase()));
  const usedTerms = words.filter((w) => used.has(w.term.toLowerCase()));
  const missed = words.filter((w) => !used.has(w.term.toLowerCase()));
  if (usedTerms.length) parts.push(`📚 Употребил слова комнаты: ${usedTerms.map((w) => `<b>${esc(w.term)}</b>`).join(", ")}`);
  if (missed.length) parts.push(`В следующий раз попробуй: ${missed.map((w) => esc(w.term)).join(", ")}`);
  parts.push("Ещё разговор — /talk");
  return parts.join("\n\n");
}

export function storyText(story: Pick<Story, "title" | "body">, glossary: Array<{ term: string; translation: string }>): string {
  const words = glossary.map((g) => `${esc(g.term)} — ${esc(g.translation)}`).join("\n");
  return `📖 <b>${esc(story.title)}</b>\n\n${boldMarked(story.body)}\n\n<b>Слова:</b>\n<tg-spoiler>${words}</tg-spoiler>`;
}

export function storyQuestionText(index: number, total: number, question: string): string {
  return `❓ ${index + 1}/${total}. ${esc(question)}`;
}

/** Всплывающее окно Telegram — не длиннее 200 символов. */
export function storyAnswerAlert(q: { options: string[]; correct: number; explanation: string }, chosen: number): string {
  const head = chosen === q.correct ? "✅ Верно!" : `❌ Правильно: ${q.options[q.correct]}`;
  const text = q.explanation ? `${head}\n\n${q.explanation}` : head;
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}

/** /start и /help: что умеет бот — по разделам, всё видно сразу. */
export function welcomeText(): string {
  const section = (title: string, lines: string[]) => [`<b>${title}</b>`, ...lines, ""].join("\n");
  return [
    "👋 <b>Привет! Я WordBoss — учу английскому вместе с друзьями.</b>",
    "Добавляешь слова из того, что читаешь, смотришь и пишешь, — я перевожу и объясняю, а потом помогаю их запомнить по интервальным повторениям (FSRS) и начать ими пользоваться.",
    "",
    "Начни с /room — создай комнату и пригласи друзей, потом /add и /learn.",
    "",
    section("➕ Добавить слова", [
      "• /add слово — или просто пришли слово в личку. Можно с переводом: bank — берег",
      "• /text — пришли текст или список: выберу, что стоит выучить, и добавлю пачкой",
      "• 📸 скриншот или фото страницы — достану слова с картинки",
      "• 🎬 ссылка на YouTube — слова из субтитров",
      "• 🧩 /extension — расширение Chrome: слово из субтитров сериала в один клик",
      "• /say фраза — как естественно сказать это по-английски, с кнопкой «добавить»",
      "К каждому слову — перевод, объяснение, пример, транскрипция 🇬🇧/🇺🇸, озвучка, запоминалка, картинка и 📍 предложение, где оно встретилось.",
    ]),
    section("🎯 Учить — /learn", [
      "Или в приложении со свайпами — /app (кнопка «📚 Учить» у поля ввода).",
      "Каждая карточка — в случайном виде:",
      "• EN → RU и RU → EN — вспомни и проверь себя под спойлером",
      "• ✍️ вставь слово в предложение",
      "• ✍️ составь своё предложение — проверю, верно ли употреблено",
      "• 🎧 диктант — услышь и напиши",
      "• 🔗 сочетания — make или do a decision?",
      "Интервалы считает FSRS. Слово никак не даётся — разберу, почему и с чем его не путать 🧩. Всё повторил — можно потренироваться вне зачёта.",
    ]),
    section("🗣 Говорить и читать", [
      "• /translate — переводи предложения с русского: они строятся под твои ошибки и слова, которые ты учишь",
      "• /talk — переписка со мной по-английски: кафе, собеседование, фильмы или своя тема. В конце — разбор ошибок",
      "• /story — короткая история из слов комнаты с озвучкой и вопросами",
      "• /audio — аудиоурок: слово, пауза, перевод, пример. Играет в фоне, с погасшим экраном — для дороги",
    ]),
    section("✍️ Работа над ошибками", [
      "• /check ответом на сообщение (или 👀 на сообщение в группе) — исправлю ошибки и подскажу, как естественнее",
      "• Ошибки сохраняются (после подтверждения), и в /learn появляются вопросы именно на них. Подряд — /drill",
      "• Тема закрывается после 3 верных ответов подряд. /mistakes — над чем работаем",
    ]),
    section("👥 Вместе с друзьями", [
      "• /room — комнаты и приглашения, /newroom название — новая комната, /link — привязать группу Telegram",
      "• Новое слово друга приходит с вопросом «знаешь?»",
      "• /duel — дуэль в группе: кто быстрее переведёт",
      "• Слово дня по утрам, 👏 когда кто-то употребил слово из словаря в переписке",
      "• /goal — общая цель комнаты на неделю, /stats — прогресс",
      "• По воскресеньям — итоги недели в группе и личный итог в личку",
    ]),
    section("⚙️ Настройки", [
      "• /settings — время напоминаний, какие упражнения включены, что показывать на карточке",
      "• /edit и /delete — исправить или удалить слово (можно по кусочку)",
      "• /bug что случилось — сообщить об ошибке (можно ответом на сообщение бота)",
    ]),
    "Этот список — /help",
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

/** Шапка карточки тренировки вне зачёта. */
export const PRACTICE_HEADER = "🔁 <i>Вне зачёта — на расписание повторений не влияет</i>\n\n";

export function practiceDoneText(): string {
  return "🔁 Тренировка закончена. Когда слова снова придут на повторение — сообщу 🔔";
}
