import { EN, langForms } from "../lang";
import { termPattern } from "../services/word-uses";
import type { ClozeSentence, Story, User, Word } from "../db/schema";
import type { Collocations, DrillQuestion, Judgement, LeechHelp, SayAnswer, SentenceReview, TalkReview, TranslationReview } from "../llm/tutor";
import { ALL_PARTS, type CardView } from "../services/card-view";
import { RESOLVE_STREAK, type DrillProgress, type MistakeProfile } from "../services/mistakes";
import type { GoalProgress } from "../services/goals";
import type { BossPace, BossPhase, BossState } from "../services/boss";
import type { WeeklyReport } from "../services/weekly-report";
import type { CheckResult } from "../llm/enricher";
import type { LeaderRow, PersonalStats } from "../services/stats";
import type { WordDraft } from "../services/words";
import { voiceLabel } from "../services/voice";
import type { SettingsScreen } from "./keyboards";

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

/** JSON-массивы карточки читаются терпимо: поле могло остаться от старой версии или прийти битым. */
function jsonArray<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

/** «noun · B1» — что за слово и на каком уровне; пусто, если модель ещё не ответила. */
export function grammarLine(word: { partOfSpeech?: string; cefr?: string }): string {
  return [word.partOfSpeech, word.cefr].filter(Boolean).map((s) => esc(String(s))).join(" · ");
}

export function formsLine(forms: string | undefined): string {
  return jsonArray<{ form: string; label: string }>(forms).map((f) => `${esc(f.form)}${f.label ? ` — ${esc(f.label)}` : ""}`).join("; ");
}

/** Синонимы и антонимы: «diversity — разнообразие». Пусто, если их нет. */
export function kinLine(title: string, raw: string | undefined): string {
  const items = jsonArray<{ term: string; translation: string }>(raw);
  return items.length ? `<b>${title}:</b> ${items.map((i) => `${esc(i.term)} — ${esc(i.translation)}`).join("; ")}` : "";
}

/**
 * Формы и родня одним компактным блоком: в боте каждый кусок через пустую строку растягивал карточку.
 * Пусто, если готовить ещё нечего.
 */
export function grammarBlock(word: GrammarFields): string {
  const lines = [
    formsLine(word.forms) ? `<b>Формы:</b> ${formsLine(word.forms)}` : "",
    kinLine("Синонимы", word.synonyms),
    kinLine("Антонимы", word.antonyms),
  ].filter(Boolean);
  return lines.join("\n");
}

function collocationsLine(collocations: string): string {
  const c = JSON.parse(collocations) as Collocations;
  return c.items.length ? `\n\n<b>Сочетания:</b>\n${c.items.slice(0, CARD_COLLOCATIONS).map((i) => `• ${esc(i.phrase)}`).join("\n")}` : "";
}

/** Кружок полезности рядом со словом на карточке — без подписи; пояснение — только в черновике при добавлении. */
const usefulnessIcon = (d: { usefulness?: number | null }) => (d.usefulness ? ` ${{ 3: "🟢", 2: "🟡", 1: "⚪️" }[d.usefulness] ?? "❔"}` : " ❔");

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

/** Оценка или явное отсутствие данных. */
export function usefulnessLine(d: { usefulness?: number | null; usefulnessNote?: string }): string {
  const label = d.usefulness ? USEFULNESS_LABELS[d.usefulness] : undefined;
  if (!label) return "❔ Полезность пока не оценена";
  return d.usefulnessNote ? `${label}: ${esc(d.usefulnessNote)}` : label;
}

/**
 * Карточка для инлайн-режима (`@бот слово` в любом чате).
 *
 * Отличия от обычной карточки осознанные: перевод **не** спрятан под спойлер (человек спрашивает
 * «что это значит» — ответ и есть цель), лишние подробности не лезут (сообщение уходит в чужой чат),
 * а `title` и `description` нужны Telegram для списка подсказок: он их обрезает сам.
 */
export function inlineWordText(w: { term: string; translation: string; explanation?: string; example?: string; transcriptionUs?: string }): string {
  const transcription = w.transcriptionUs ? ` [${esc(w.transcriptionUs)}]` : "";
  let text = `<b>${esc(w.term)}</b>${transcription} — ${esc(w.translation)}`;
  if (w.example) text += `\n\n<i>${esc(w.example)}</i>`;
  else if (w.explanation) text += `\n\n${esc(w.explanation)}`;
  return text;
}

/** Строка для списка подсказок: Telegram показывает её рядом с заголовком. */
export function inlineWordDescription(w: { translation: string; explanation?: string }): string {
  return (w.explanation || w.translation).slice(0, 120);
}

/** Поля слова, которые заполняет фоновая генерация грамматики. */
export interface GrammarFields {
  partOfSpeech?: string;
  cefr?: string;
  forms?: string;
  synonyms?: string;
  antonyms?: string;
}

export function draftText(d: WordDraft & GrammarFields): string {
  let text = `<b>${esc(d.term)}</b> — ${esc(d.translation)}${withTranscription(d)}`;
  const head = grammarLine(d);
  if (head) text += `\n${head}`;
  const useful = usefulnessLine(d);
  if (useful) text += `\n${useful}`;
  if (d.explanation) text += `\n\n${esc(d.explanation)}`;
  if (d.example) text += `\n\n<i>${esc(d.example)}</i>`;
  const grammar = grammarBlock(d);
  if (grammar) text += `\n\n${grammar}`;
  if (d.context) text += `\n\n${contextLine(d.context, d.term)}`;
  if (d.mnemonic) text += `\n\n💡 ${esc(d.mnemonic)}`;
  return text;
}

/** Карточка для /learn: слово видно, ответ спрятан под спойлер Telegram (тап — открыть). */
/** Карточка EN → RU. view — что показывать (настройка пользователя); запоминалка под спойлером, т.к. подсказывает ответ. */
/**
 * Подробности — под спойлером, чтобы объяснение не подсказывало ответ до проверки.
 */
function cardDetails(word: WordDraft & GrammarFields & { collocations?: string; moreContexts?: string }, view: CardView, withExplanation: boolean): string {
  let text = "";
  if (withExplanation && view.explanation && word.explanation) text += `\n\n${esc(word.explanation)}`;
  if (view.example && word.example) text += `\n\n<b>Пример:</b> <i>${esc(word.example)}</i>`;
  if (view.context) text += contextBlock(word);
  if (view.collocations && word.collocations) text += collocationsLine(word.collocations);
  if (view.mnemonic && word.mnemonic) text += `\n\n<b>Как запомнить:</b> ${esc(word.mnemonic)}`;
  const grammar = grammarBlock(word);
  if (grammar) text += `\n\n${grammar}`;
  const body = text.replace(/^\n\n/, "");
  return body ? `\n\n<tg-spoiler>${body}</tg-spoiler>` : "";
}

export function cardText(word: WordDraft & GrammarFields & { collocations?: string; moreContexts?: string }, view: CardView = ALL_PARTS): string {
  const answer = `<tg-spoiler><b>${esc(word.translation)}</b></tg-spoiler>`;
  const grammar = view.explanation ? grammarLine(word) : "";
  return `<b>${esc(word.term)}</b>${usefulnessIcon(word)}${withTranscription(word, view.transcription)}${grammar ? `\n${grammar}` : ""}\n\n${answer}${cardDetails(word, view, true)}\n\nВспомни перевод и проверь себя тапом:`;
}

export function knowPrompt(adderName: string, word: Word, roomName: string): string {
  return `📥 ${esc(adderName)} добавил(а) в «${esc(roomName)}»:\n\n<b>${esc(word.term)}</b> — <tg-spoiler>${esc(word.translation)}</tg-spoiler>${withTranscription(word)}\n\nЗнаешь это слово?`;
}

/**
 * due — число к повторению или по отдельности: к повторению и новые.
 * `fresh` — новые, которые **можно** показать сегодня (уже с учётом дневной порции, E30);
 * `waiting` — сколько новых ждёт своей очереди сверх неё. Про очередь говорим отдельной строкой и
 * спокойно: «ещё 105 ждут» — это не «105 слов просрочено», их не надо догонять сегодня.
 * `lastChance` — до конца недели комнаты осталось мало: об этом говорим в том же сообщении, потому что
 * отдельное напоминание за пару часов до сброса человек прочитает уже после него.
 */
export function reminderText(
  due: number | { review: number; fresh: number; waiting?: number },
  friend?: { name: string; reviews: number },
  lastChance?: { roomName: string; hours: number },
): string {
  const { review, fresh, waiting } = typeof due === "number" ? { review: due, fresh: 0, waiting: 0 } : due;
  const waits = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "ждёт" : "ждут");
  const newWords = `${fresh} ${plural(fresh, "новое слово", "новых слова", "новых слов")}`;
  const base = review
    ? `🔔 ${review} ${plural(review, "слово", "слова", "слов")} ${waits(review)} повторения${fresh ? ` + ${newWords}` : ""}`
    : `🆕 ${newWords} ${waits(fresh)} знакомства`;
  // Очередь — отдельной строкой и только когда она есть: это запас, а не долг.
  const queue = waiting ? `\n📚 Ещё ${waiting} ${plural(waiting, "новое слово ждёт", "новых слова ждут", "новых слов ждут")} своей очереди — придут в следующие дни.` : "";
  const withFriend = friend ? `${base} · ${esc(friend.name)} сегодня уже повторил(а) ${friend.reviews} 🔥` : base;
  if (!lastChance) return withFriend + queue;
  // Часы в поясе КОМНАТЫ: неделя кончается у неё, а не у человека.
  const left = lastChance.hours <= 1
    ? "меньше часа"
    : `${lastChance.hours} ${plural(lastChance.hours, "час", "часа", "часов")}`;
  return `${withFriend}\n\n⏳ До конца недели в «${esc(lastChance.roomName)}» — ${left}. Успей добить босса.${queue}`;
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
  // «Герой недели» — сравнение между людьми, поэтому в комнате с одним участником его нет: там первая
  // строка таблицы всегда этот же человек, и поздравление «победил» приходит ему же (E8). Звание
  // требует, чтобы было с кем сравнивать, а не только чтобы были повторения.
  const hero = rows.length > 1 && rows[0] && rows[0].reviews7d > 0 ? `\n\nГерой недели: <b>${esc(rows[0].name)}</b> 🎉` : "";
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

export function goalText(roomName: string, g: GoalProgress, timeZone?: string): string {
  const percent = Math.round((g.done / Math.max(1, g.target)) * 100);
  const lines = [
    `🎯 <b>Цель «${esc(roomName)}» на неделю</b>: ${g.done}/${g.target} HP${g.done >= g.target ? " ✅" : ""}`,
    `${progressBar(g.done, g.target)} ${percent}%`,
  ];
  if (g.byUser.length) lines.push(`Вклад: ${g.byUser.map((u) => `${esc(u.name)} ${u.count}`).join(" · ")}`);
  lines.push(
    "",
    g.auto ? "Цель одна для всех — 100 HP. Своя — /goal 600" : "Вернуть общую цель — /goal auto",
    weekEndNote(timeZone),
  );
  return lines.join("\n");
}

/**
 * Когда кончается неделя — по поясу комнаты.
 *
 * Время в тексте подставляется из того же пояса, в котором считается граница: комната в Москве кончается
 * в 20:00 МСК, и писать ей «20:00» без пояса значит обещать не то время, в которое закроется неделя.
 */
export function weekEndNote(timeZone?: string): string {
  if (!timeZone) return "Неделя заканчивается в воскресенье в 20:00.";
  const offset = new Intl.DateTimeFormat("ru-RU", { timeZone, timeZoneName: "shortOffset" })
    .formatToParts(new Date())
    .find((p) => p.type === "timeZoneName")?.value;
  return `Неделя заканчивается в воскресенье в 20:00${offset ? ` (${offset})` : ""}.`;
}

/**
 * 🏆 «Ты получил трофеи» — в личку в воскресенье. Список короткий: три-четыре трофея,
 * и у каждого — как он достался, иначе непонятно, за что.
 */
export function trophiesText(earned: Array<{ emoji: string; title: string; how: string }>): string {
  const lines = earned.map((t) => `${t.emoji} <b>${esc(t.title)}</b> — ${esc(t.how)}`);
  const head = earned.length === 1 ? "🏆 <b>Новый трофей</b>" : `🏆 <b>Новые трофеи: ${earned.length}</b>`;
  return [head, "", ...lines, "", "Вся коллекция — в приложении на вкладке 🐉"].join("\n");
}

/**
 * 🎯🎉 Комната добила цель недели — сообщение в чат.
 *
 * Добивающий удар называется по имени: без него текст читался как отчёт («выполнила цель»), а
 * в пошаговой игре важен момент, когда босс упал, и кто это сделал. `finalBlow` есть только у
 * добивания; если его нет (цель закрыли суммой многих ударов), текст остаётся счётом.
 */
export function goalReachedText(roomName: string, g: GoalProgress, finalBlow?: { name: string }): string {
  const top = g.byUser[0] ? ` Больше всех — ${esc(g.byUser[0].name)} (${g.byUser[0].count})` : "";
  const blow = finalBlow ? `\n⚔️ Добил(а): <b>${esc(finalBlow.name)}</b> — босс повержен!` : "";
  return `🎯🎉 «${esc(roomName)}» выполнила цель недели: ${g.done}/${g.target} HP!${top}${blow}`;
}

/**
 * 🐉 Босс недели в /goal и /boss. Тот же расчёт, что у цели, но показан боем: HP, фаза, кто сколько снял.
 *
 * Порядок строк — от «что сейчас» к «что делать»: сначала босс и его HP, потом темп, потом люди.
 * Подпись босса меняется от фазы: он должен выглядеть живым, иначе это прогресс-бар с ушами.
 */
export function bossText(b: BossState, feed?: { byUser: Array<{ name: string; damage: number }> }): string {
  const percent = Math.round(Math.min(1, b.damage) * 100);
  const role: Record<BossPhase, string> = {
    fresh: "🐉 <b>Босс недели</b> — пока только проснулся",
    angry: "🐲 <b>Босс злится</b> — дело пошло",
    furious: "🔥 <b>Босс в ярости</b> — ещё немного",
    dead: "💀 <b>Босс повержен</b>",
  };
  const pace: Record<BossPace, string> = {
    ahead: "опережаете график 👍",
    "on-time": "идёте в темпе",
    behind: "отстаёте от графика",
  };
  const lines = [
    role[b.phase],
    esc(b.opponent.name),
    `${progressBar(b.done, b.target)} ${percent}%`,
    b.phase === "dead" ? `Урон: ${b.done} из ${b.target}. Следующий босс — в воскресенье, монеты ещё начисляются.` : `HP: ${b.hp} из ${b.bossHp} · ${pace[b.pace]}`,
  ];
  // Добитые боссы на этой неделе: арена не пустует, следующий уже стоит.
  if (b.kills > 0) {
    const word = b.kills === 1 ? "босс" : "боссов";
    lines.push(`🏆 Добито на этой неделе: ${b.kills} ${word}. Сейчас на арене — ${b.round}-й.`);
  }
  if (b.phase !== "dead") {
    lines.push(b.daysLeft > 0 ? `До конца недели — ${b.daysLeft} ${plural(b.daysLeft, "день", "дня", "дней")} (${weekEndNote(b.timeZone)}).` : "Последний день недели — добиваем сегодня.");
    if (b.opponent.id === "sentinel" && b.hp <= b.target / 2) {
      lines.push("Открыто ядро Стража. Один ручной удар из запаса за бой получает +20%.");
    }
    if (b.opponent.id === "dragon" && b.phase === "furious") lines.push("Диктанты дают +20% базового урона, пока Дракон в ярости.");
  }
  const byUser = feed?.byUser.length ? feed.byUser : b.byUser.map((u) => ({ name: u.name, damage: u.count }));
  if (byUser.length) lines.push("", `Удары: ${byUser.map((u) => `${esc(u.name)} ${u.damage}`).join(" · ")}`);
  lines.push("", "Каждая повторённая карточка — удар. Учить — /learn. Выключить босса — /settings.");
  return lines.join("\n");
}

/**
 * Лента ударов: «Александр нанёс 12 урона». Своё в ленте тоже показываем — так видно, что удар засчитан.
 */
export function bossHitsText(hits: Array<{ name: string; damage: number; at: Date }>, timeZone: string): string {
  if (hits.length === 0) return "🐉 Пока тихо. Первый удар — любая карточка в /learn.";
  const lines = hits.slice(0, 10).map((h) => {
    const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone }).format(h.at);
    return `⚔️ <b>${esc(h.name)}</b> нанёс ${h.damage} HP урона в ${time}`;
  });
  return lines.join("\n");
}

/**
 * Экран «Готово». `empty` — у человека вообще нет слов, и это совсем другой случай, чем «всё повторил».
 *
 * Без этого различия новичок, открывший `/learn` с пустым словарём, читал «появятся сами — бот напомнит»
 * и уходил ждать: ждать было нечего, слов не было вовсе. Ему надо предложить /sets, а не тишину.
 */
export function doneText(reviewed: number, next: Date | undefined, timeZone: string, empty = false): string {
  if (empty && reviewed === 0) {
    return "📦 Слов пока нет — учить нечего.\nВозьми готовый набор: /sets — уровни A1–C1 и темы, листаешь «знаю / учу / не для меня».";
  }
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
  if (goal) lines.push("", `🎯 Цель недели: ${goal.done}/${goal.target} ${progressBar(goal.done, goal.target)} — /goal · босс — /boss`);
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

/**
 * Итог пачки. `refused` — пачка остановилась на лимите, и человеку надо сказать это прямо:
 * иначе он видит «Добавлено: 3» без объяснения, почему было отмечено десять.
 */
export function batchDoneText(words: Array<{ term: string }>, refused = false): string {
  if (!words.length) {
    return refused ? "Лимит слов на сегодня выбран — ничего не добавлено. Завтра продолжим, а пока повтори уже добавленное: /learn" : "Ничего не добавлено";
  }
  const done = `✅ Добавлено: ${words.length} — ${termsList(words)}`;
  return refused ? `${done}\n\nОстальные не влезли в лимит слов — продолжим завтра.` : done;
}

/** Ступень 2: русский перевод виден, английское слово с транскрипцией и примером — под спойлером. */
/** Объяснение до ответа — только по-русски: slay тоже выдаёт slain, хотя основы не совпадают. */
export function reverseHint(word: Pick<WordDraft, "term" | "explanation">): string {
  const explanation = word.explanation?.trim() ?? "";
  return EN.script.test(explanation) ? "" : explanation;
}

export function reverseCardText(word: WordDraft & { collocations?: string; moreContexts?: string }, view: CardView = ALL_PARTS): string {
  const answer = `<tg-spoiler><b>${esc(word.term)}</b>${withTranscription(word, view.transcription)}</tg-spoiler>`;
  const hint = view.explanation ? reverseHint(word) : "";
  return `🇷🇺 <b>${esc(word.translation)}</b>${usefulnessIcon(word)}${hint ? `\n<i>${esc(hint)}</i>` : ""}\n\n${answer}${cardDetails(word, view, false)}\n\nВспомни ${langForms().adv} и проверь себя тапом:`;
}

/**
 * Подставляет ответ в пропуск, ответ — жирным. Модель иногда кладёт в вариант и соседнее слово
 * («We need ___ gold» + «the gold»): повторяющиеся на стыке слова убираем, иначе выходит «the gold gold».
 */
export function fillGap(sentence: string, answer: string): string {
  const { before, after } = gapParts(sentence, answer);
  return `${esc(before)}<b>${esc(answer)}</b>${esc(after)}`;
}

/** Пропуск — три и больше подчёркиваний подряд: модель пишет и `___`, и `_______`. */
const GAP = /_{3,}/;

/** То же без разметки: что до пропуска и что после (повтор на стыке уже убран) — приложение рисует ответ само. */
export function gapParts(sentence: string, answer: string): { before: string; answer: string; after: string } {
  // Режем по всему пропуску целиком, а не по трём подчёркиваниям: `pickled onion` приходило с
  // `_______`, и после подстановки оставалось лишнее `____` на месте ответа (баг #25).
  const at = sentence.search(GAP);
  const before = at < 0 ? sentence : sentence.slice(0, at);
  const afterGap = at < 0 ? "" : sentence.slice(at).replace(GAP, "");
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
  let after = afterGap;
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
    return done ? `🎉 Все темы отработаны!\n\n${done}` : `🧠 Пока ошибок не записано. Их собирает /check — ответом на сообщение ${langForms().prep}.`;
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

export function settingsText(user: User, screen: SettingsScreen = "main"): string {
  if (screen === "remind") return `⏰ Напоминаю в ${user.reminderTime} (${user.timezone}). Выбери час или отправь /settings ЧЧ:ММ`;
  if (screen === "modes") return "🎯 Упражнения в /learn — каждая карточка приходит в случайном из включённых (новое слово — сначала EN → RU):";
  if (screen === "card") return "🃏 Что показывать на карточке в /learn (перевод — всегда):";
  if (screen === "voice") {
    return [
      "🗣 <b>Озвучка карточек в приложении.</b>",
      "",
      "В боте слово всегда звучит по кнопке. В приложении (Mini App) выбранный вариант играет сам — как только карточка показала ответ.",
      "",
      `Сейчас: <b>${esc(voiceLabel(user))}</b>.`,
    ].join("\n");
  }
  if (screen === "new") {
    // Число называем словами, а не только галочкой в кнопке: «сколько это в ответах» — вопрос, который
    // возникает сразу, и на него лучше ответить здесь, чем оставлять человека гадать.
    const now = user.newPerDay <= 0 ? "без ограничения — все новые слова сразу" : `${user.newPerDay} ${plural(user.newPerDay, "новое слово", "новых слова", "новых слов")} в день`;
    return [
      "🆕 <b>Сколько новых слов в день.</b>",
      "",
      "Считаются только <b>новые</b> слова: первую встречу с каждым словом занимает порция. Повторения приходят всегда и от порции не зависят — их нельзя отложить.",
      "",
      `Сейчас: <b>${esc(now)}</b>.`,
      user.newPerDay <= 0 ? "⚠️ Вся пачка от друзей падает сразу — при большом словаре так легко утонуть." : "Остальные новые слова ждут своей очереди в следующие дни: сначала самые полезные, ничего не теряется.",
    ].join("\n");
  }
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
  return `🇷🇺 <b>${esc(ru)}</b>\n\nПереведи на ${langForms().acc}:`;
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
  return `${EN.flag} Как сказать «${esc(phrase)}»:\n\n${variants.join("\n")}${learn}`;
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
    "👋 <b>Привет! Я WordBoss — помогаю учить английские слова.</b>",
    "Добавляешь слова из того, что читаешь, смотришь и пишешь, — я перевожу и объясняю, а потом помогаю их запомнить по интервальным повторениям (FSRS) и начать ими пользоваться.",
    "",
    "Начать просто: пришли мне любое английское слово (или по-русски — подберу английское) или возьми готовый набор — /sets. Потом /learn или /app.",
    "Можно учить и вместе с друзьями — об этом ниже.",
    "🇰🇷 Учишь корейский? /lang — переключиться: всё то же самое будет для корейского.",
    "",
    section("➕ Добавить слова", [
      "• /add слово — или просто пришли слово в личку. Можно с переводом: bank — берег",
      "• /text — пришли текст или список: выберу, что стоит выучить, и добавлю пачкой",
      "• 📸 скриншот или фото страницы — достану слова с картинки",
      "• 🎬 ссылка на YouTube — слова из субтитров",
      "• 🧩 /extension — расширение Chrome: слово из субтитров сериала в один клик",
      "• /say фраза — как естественно сказать это по-английски, с кнопкой «добавить»",
      "• 📦 /sets — готовые наборы по уровням (A1–C1) и темам: листаешь и выбираешь, что учить",
      "• 📘 /grammar — грамматика: темы по уровням, правило, упражнения и экзамен. Ответ проверяется сразу, без модели",
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
      "• /talk — разговор со мной по-английски, текстом или голосовыми: кафе, собеседование, фильмы или своя тема. В конце — разбор ошибок",
      "• /pron слово — 🎤 произношение: скажи голосовым, проверю, поймут ли тебя, и подскажу, какой звук звучит не так",
      "• /story — короткая история из твоих слов с озвучкой и вопросами",
      "• /audio — аудиоурок: слово, пауза, перевод, пример. Играет в фоне, с погасшим экраном — для дороги",
    ]),
    section("✍️ Работа над ошибками", [
      "• /check ответом на сообщение (или 👀 на сообщение в группе) — исправлю ошибки и подскажу, как естественнее",
      "• Ошибки сохраняются (после подтверждения), и в /learn появляются вопросы именно на них. Подряд — /drill",
      "• Тема закрывается после 3 верных ответов подряд. /mistakes — над чем работаем",
    ]),
    section("👥 Вместе с друзьями", [
      "• Твои слова — в личном словаре «Мои слова». Учить с друзьями — в общей комнате: /room → «Комната для друзей», позови их ссылкой (или вступи по ссылке друга). /link в группе — привязать её к комнате или сменить комнату (и язык). /roomtz — часовой пояс комнаты: по нему кончается неделя босса",
      "• Новое слово друга приходит с вопросом «знаешь?»",
      "• /duel — дуэль в группе: кто быстрее переведёт",
      "• Слово дня по утрам, 👏 когда кто-то употребил слово из словаря в переписке",
      "• /goal — общая цель комнаты на неделю, /stats — прогресс",
      "• 🐉 /boss — босс недели: та же цель, но боем. Каждая повторённая карточка — удар, в приложении есть вкладка с боссом. Выключается в /settings",
      "• 🪙 /upgrade — усиление за монеты недели: монеты это твой урон, каждый уровень даёт +10%. Сгорают в воскресенье",
      "• По воскресеньям — итоги недели в группе и личный итог в личку",
    ]),
    section("⚙️ Настройки", [
      "• /settings — время напоминаний, какие упражнения включены, что показывать на карточке",
      "• /edit и /delete — исправить или удалить слово (можно по кусочку)",
      "• /bug что случилось — сообщить об ошибке (можно ответом на сообщение бота)",
      "• /status — чем бот сейчас работает: модели, картинки, ключи (видит только админ)",
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
