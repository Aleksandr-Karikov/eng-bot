import { InlineKeyboard } from "grammy";
import type { Room, User } from "../db/schema";
import type { DrillQuestion } from "../llm/tutor";
import { cardView, type CardPart } from "../services/card-view";
import type { Stage } from "../services/exercises";
import type { Batch } from "./batches";
import type { Picker } from "./pickers";
import { encodeCb } from "./callbacks";

export const USEFULNESS_ICONS: Record<number, string> = { 3: "🟢", 2: "🟡", 1: "⚪️" };

export function knowKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Знаю", encodeCb({ k: "know", wordId, knows: true }))
    .text("📚 Не знаю", encodeCb({ k: "know", wordId, knows: false }))
    .row()
    .text("🙈 Не для меня", encodeCb({ k: "notForMe", wordId, from: "know" }));
}

export function restoreCardKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard().text("↩️ Вернуть", encodeCb({ k: "restoreCard", wordId }));
}

/** Две оценки — «не вспомнил / вспомнил»: «С трудом» убрана, а в старых сообщениях она по-прежнему обрабатывается. */
/** Ряд «🔊 UK / 🔊 US». */
export function addAudioRow(kb: InlineKeyboard, wordId: number): InlineKeyboard {
  return kb
    .text("🔊 UK", encodeCb({ k: "audio", wordId, accent: "uk" }))
    .text("🔊 US", encodeCb({ k: "audio", wordId, accent: "us" }))
    .row();
}

export function audioKeyboard(wordId: number): InlineKeyboard {
  return addAudioRow(new InlineKeyboard(), wordId);
}

/** withAudio — только там, где озвучка не подсказывает ответ (EN → RU, после ответа). */
export function rateKeyboard(cardId: number, reps: number, isNew: boolean, wordId: number, withAudio = false, stage?: Stage): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("😵 Забыл", encodeCb({ k: "rate", cardId, reps, answer: "again", stage }))
    .text("😎 Помню", encodeCb({ k: "rate", cardId, reps, answer: "good", stage }));
  if (isNew) kb.row().text("✅ Уже знаю", encodeCb({ k: "rate", cardId, reps, answer: "easy", stage }));
  kb.row();
  if (withAudio) addAudioRow(kb, wordId);
  return addManageButton(kb, wordId);
}

/** Действия со словом (картинка, изменить, удалить) спрятаны за одну кнопку, чтобы не мешать тренировке. */
const MANAGE_TAGS = new Set(["im", "rd", "e", "x", "wm", "uf", "nf"]);

export function addManageButton(kb: InlineKeyboard, wordId: number): InlineKeyboard {
  return kb.text("⚙️ Управление словом", encodeCb({ k: "manage", wordId, open: true }));
}

type Rows = InlineKeyboard["inline_keyboard"];

/** Клавиатура сообщения без кнопок управления словом — основа для раскрытия и сворачивания. */
function withoutManage(rows: Rows): InlineKeyboard {
  const kept = rows
    .map((row) => row.filter((b) => !("callback_data" in b && MANAGE_TAGS.has(b.callback_data.split(":")[0] ?? ""))))
    .filter((row) => row.length > 0);
  return new InlineKeyboard(kept).row();
}

/** picture — можно нарисовать/показать картинку; redraw — картинка уже на карточке, её можно перерисовать. */
/** promote — слово необязательное (учим только на узнавание): можно «сделать полезным». */
export function expandManage(rows: Rows, wordId: number, opts: { picture: boolean; redraw: boolean; promote?: boolean }): InlineKeyboard {
  const kb = withoutManage(rows);
  if (opts.redraw) kb.text("🔄 Перерисовать", encodeCb({ k: "redraw", wordId })).row();
  else if (opts.picture) kb.text("🖼 Картинка", encodeCb({ k: "picture", wordId })).row();
  if (opts.promote) kb.text("⭐ Сделать полезным — учить полностью", encodeCb({ k: "promote", wordId })).row();
  return kb
    .text("✏️ Изменить", encodeCb({ k: "edit", wordId }))
    .text("🗑 Удалить у всех", encodeCb({ k: "del", wordId }))
    .row()
    .text("🙈 Убрать только у меня", encodeCb({ k: "notForMe", wordId, from: "learn" }))
    .row()
    .text("▴ Скрыть", encodeCb({ k: "manage", wordId, open: false }));
}

export function collapseManage(rows: Rows, wordId: number): InlineKeyboard {
  return addManageButton(withoutManage(rows), wordId);
}

export function learnKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("▶️ Начать", encodeCb({ k: "learn" }));
}

export function draftKeyboard(id: number, inBatch = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("➕ Добавить", encodeCb({ k: "draft", id, action: "ok" }))
    .text("✏️ Исправить", encodeCb({ k: "draft", id, action: "edit" }));
  if (!inBatch) return kb.text("❌ Отмена", encodeCb({ k: "draft", id, action: "cancel" }));
  return kb
    .text("⏭ Пропустить", encodeCb({ k: "draft", id, action: "skip" }))
    .row()
    .text("⏹ Хватит", encodeCb({ k: "draft", id, action: "stop" }));
}

const BUTTON_LABEL_MAX = 40;
const shorten = (s: string) => (s.length > BUTTON_LABEL_MAX ? `${s.slice(0, BUTTON_LABEL_MAX - 1)}…` : s);

/** Строк на странице: 25 + навигация + управление — далеко от лимита Telegram в 100 кнопок. */
const PAGE_SIZE = 25;

const pageCount = (total: number) => Math.max(1, Math.ceil(total / PAGE_SIZE));

/** Ряд ◀ p/n ▶, если страниц больше одной; go(p) кодирует переход на страницу p. */
function addPageNav(kb: InlineKeyboard, page: number, pages: number, go: (p: number) => string): void {
  if (pages <= 1) return;
  const to = (p: number) => go(Math.min(Math.max(p, 0), pages - 1));
  kb.text("◀", to(page - 1)).text(`${page + 1}/${pages}`, to(page)).text("▶", to(page + 1)).row();
}

export function batchPageCount(batch: Batch): number {
  return pageCount(batch.items.length);
}

export function batchKeyboard(batch: Batch): InlineKeyboard {
  const kb = new InlineKeyboard();
  const pages = batchPageCount(batch);
  const page = Math.min(batch.page, pages - 1);
  const start = page * PAGE_SIZE;
  batch.items.slice(start, start + PAGE_SIZE).forEach((item, offset) => {
    const index = start + offset;
    const mark = batch.selected[index] ? "✅" : "⬜️";
    const useful = item.usefulness ? `${USEFULNESS_ICONS[item.usefulness] ?? ""} ` : "";
    kb.text(shorten(`${mark} ${useful}${item.term} — ${item.translation}`), encodeCb({ k: "batchToggle", id: batch.id, index })).row();
  });
  addPageNav(kb, page, pages, (p) => encodeCb({ k: "batchPage", id: batch.id, page: p }));
  return kb
    .text(`✅ Добавить (${batch.selectedItems().length})`, encodeCb({ k: "batch", id: batch.id, action: "add" }))
    .text("🔍 По одному", encodeCb({ k: "batch", id: batch.id, action: "review" }))
    .row()
    .text("❌ Отмена", encodeCb({ k: "batch", id: batch.id, action: "cancel" }));
}

/** canManage — переименовать и удалить текущую комнату может только её создатель. */
export function roomKeyboard(otherRooms: Room[], current?: Room, canManage = false): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (current) kb.text("🔗 Пригласить", encodeCb({ k: "room", action: "invite" }));
  kb.text("➕ Новая комната", encodeCb({ k: "room", action: "new" }));
  for (const room of otherRooms) kb.row().text(`→ ${room.name}`, encodeCb({ k: "roomsw", roomId: room.id }));
  if (current && canManage) {
    kb.row()
      .text("✏️ Переименовать", encodeCb({ k: "roomRename", roomId: current.id }))
      .text("🗑 Удалить комнату", encodeCb({ k: "roomDel", roomId: current.id }));
  }
  return kb;
}

export function confirmRoomDeleteKeyboard(roomId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("🗑 Да, удалить", encodeCb({ k: "roomDelOk", roomId }))
    .text("Отмена", encodeCb({ k: "delCancel" }));
}

const HOURS = [8, 9, 12, 18, 19, 20, 21, 22];

export function hoursKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  HOURS.forEach((hour, i) => {
    if (i === 4) kb.row();
    kb.text(`${String(hour).padStart(2, "0")}:00`, encodeCb({ k: "hour", hour }));
  });
  return kb;
}

export function wordActionsKeyboard(wordId: number, withPicture = false): InlineKeyboard {
  const kb = addAudioRow(new InlineKeyboard(), wordId);
  if (withPicture) kb.text("🖼 Картинка", encodeCb({ k: "picture", wordId })).row();
  return kb
    .text("✏️ Изменить", encodeCb({ k: "edit", wordId }))
    .text("🗑 Удалить", encodeCb({ k: "del", wordId }));
}

export function confirmDeleteKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Да", encodeCb({ k: "delOk", wordId })).text("Отмена", encodeCb({ k: "delCancel" }));
}

export function batchUndoKeyboard(batchId: number, count: number): InlineKeyboard {
  return new InlineKeyboard().text(`🗑 Удалить всё (${count})`, encodeCb({ k: "delBatch", id: batchId }));
}

export function confirmBatchDeleteKeyboard(batchId: number): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Да", encodeCb({ k: "delBatchOk", id: batchId })).text("Отмена", encodeCb({ k: "delCancel" }));
}

export function pickerPageCount(picker: Picker): number {
  return pageCount(picker.items.length);
}

export function pickerKeyboard(picker: Picker): InlineKeyboard {
  const kb = new InlineKeyboard();
  const pages = pickerPageCount(picker);
  const page = Math.min(picker.page, pages - 1);
  for (const item of picker.items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const cb = picker.action === "edit" ? encodeCb({ k: "edit", wordId: item.wordId }) : encodeCb({ k: "del", wordId: item.wordId });
    kb.text(shorten(item.label), cb).row();
  }
  addPageNav(kb, page, pages, (p) => encodeCb({ k: "delPage", id: picker.id, page: p }));
  return kb.text("Отмена", encodeCb({ k: "delCancel" }));
}

export function clozeKeyboard(cardId: number, reps: number, wordId: number): InlineKeyboard {
  return addManageButton(new InlineKeyboard().text("🤷 Не знаю", encodeCb({ k: "dunno", cardId, reps })).row(), wordId);
}

const CARD_PART_LABELS: Array<[CardPart, string]> = [
  ["transcription", "🔤 Транскрипция"],
  ["explanation", "📖 Объяснение"],
  ["example", "✏️ Пример"],
  ["context", "📍 Где встретилось"],
  ["collocations", "🔗 С чем сочетается"],
  ["mnemonic", "💡 Запоминалка"],
  ["audio", "🔊 Озвучка"],
  ["picture", "🖼 Картинки"],
];

const MODE_LABELS: Array<[Stage, string, keyof User]> = [
  ["en_ru", "EN → RU", "modeEnRu"],
  ["ru_en", "RU → EN", "modeRuEn"],
  ["cloze", "Вставь по смыслу", "modeCloze"],
  ["sentence", "✍️ Своё предложение", "modeSentence"],
  ["listen", "🎧 Диктант", "modeListen"],
  ["collocation", "🔗 Сочетания", "modeCollocation"],
];

/** Часы напоминания + переключатели режимов тренажёра. */
export type SettingsScreen = "main" | "remind" | "modes" | "card";

/** /settings по экранам: на одном сообщении было ~27 кнопок. */
export function settingsKeyboard(user: User, screen: SettingsScreen = "main"): InlineKeyboard {
  const back = (kb: InlineKeyboard) => kb.row().text("◀ Назад", encodeCb({ k: "settingsScreen", screen: "main" }));
  if (screen === "main") {
    return new InlineKeyboard()
      .text("⏰ Напоминания", encodeCb({ k: "settingsScreen", screen: "remind" }))
      .row()
      .text("🎯 Упражнения", encodeCb({ k: "settingsScreen", screen: "modes" }))
      .row()
      .text("🃏 Карточка", encodeCb({ k: "settingsScreen", screen: "card" }));
  }
  if (screen === "remind") {
    const kb = hoursKeyboard().row();
    kb.text(`${user.notifyDue ? "✅" : "⬜️"} 🔔 Когда снова есть что повторить`, encodeCb({ k: "notifyDue" })).row();
    kb.text(`${user.weeklyReport ? "✅" : "⬜️"} 📬 Итог недели в воскресенье`, encodeCb({ k: "weeklyReport" }));
    return back(kb);
  }
  if (screen === "modes") {
    const kb = new InlineKeyboard();
    for (const [stage, label, field] of MODE_LABELS) kb.text(`${user[field] ? "✅" : "⬜️"} ${label}`, encodeCb({ k: "mode", stage })).row();
    kb.text(`${user.modeDrill ? "✅" : "⬜️"} 🧠 Вопросы по ошибкам в /learn`, encodeCb({ k: "drillMode" }));
    return back(kb);
  }
  const kb = new InlineKeyboard();
  const view = cardView(user);
  CARD_PART_LABELS.forEach(([part, label], i) => {
    if (i % 2 === 0 && i > 0) kb.row();
    kb.text(`${view[part] ? "✅" : "⬜️"} ${label}`, encodeCb({ k: "cardPart", part }));
  });
  return back(kb);
}

/** qid — номер показа вопроса: старые кнопки не должны оценивать другой, текущий вопрос. */
export function drillKeyboard(q: DrillQuestion, qid: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  q.options.forEach((option, index) => kb.text(shorten(option), encodeCb({ k: "drillPick", qid, index })).row());
  return kb;
}

export function duelKeyboard(roundId: number, options: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((option, index) => kb.text(shorten(option), encodeCb({ k: "duel", roundId, index })).row());
  return kb;
}

export function mistakesAskKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Сохранить", encodeCb({ k: "mistakesSave", id, save: true }))
    .text("✖️ Не сохранять", encodeCb({ k: "mistakesSave", id, save: false }));
}

/** /mistakes — центр работы над ошибками: отсюда и вопросы, и перевод. */
export function mistakesKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🧠 Вопросы по ошибкам", encodeCb({ k: "mistakesGo", to: "drill" }))
    .text("🇷🇺→🇬🇧 Перевод", encodeCb({ k: "mistakesGo", to: "translate" }))
    .row()
    .text("🗑 Сбросить", encodeCb({ k: "mistakesClear" }));
}

/** Под запоминалкой: нарисовать (или показать уже нарисованную) картинку — если картинки включены. */
export function mnemonicKeyboard(wordId: number, hasPicture: boolean): InlineKeyboard {
  return new InlineKeyboard().text(hasPicture ? "🖼 Картинка" : "🖼 Нарисовать", encodeCb({ k: "picture", wordId }));
}

export function practiceStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🔁 Потренироваться вне зачёта", encodeCb({ k: "practiceStart" }));
}

export function practiceKeyboard(cardId: number, wordId: number, withAudio: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("😵 Забыл", encodeCb({ k: "practiceRate", cardId, remembered: false }))
    .text("😎 Помню", encodeCb({ k: "practiceRate", cardId, remembered: true }))
    .row();
  if (withAudio) addAudioRow(kb, wordId);
  return addManageButton(kb.text("⏹ Хватит", encodeCb({ k: "practiceStop" })).row(), wordId);
}

export function practiceClozeKeyboard(cardId: number, wordId: number): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🤷 Не знаю", encodeCb({ k: "practiceDunno", cardId }))
    .text("⏹ Хватит", encodeCb({ k: "practiceStop" }))
    .row();
  return addManageButton(kb, wordId);
}

export function pictureKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard().text("🔄 Перерисовать", encodeCb({ k: "redraw", wordId }));
}

export function redrawMenuKeyboard(wordId: number, styles: ReadonlyArray<{ label: string }>): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("🎲 Ещё вариант", encodeCb({ k: "redrawAs", wordId, how: "again" }))
    .text("✍️ Свой вариант", encodeCb({ k: "redrawAs", wordId, how: "custom" }))
    .row();
  styles.forEach((s, i) => {
    if (i > 0 && i % 3 === 0) kb.row();
    kb.text(`🎨 ${s.label}`, encodeCb({ k: "redrawAs", wordId, how: i }));
  });
  return kb;
}

export function storyKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard().text("🔊 Послушать", encodeCb({ k: "storyAudio", id }));
}

export function storyQuestionKeyboard(id: number, q: number, options: string[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((option, index) => kb.text(option, encodeCb({ k: "storyAnswer", id, q, index })).row());
  return kb;
}

/** Под разбором трудного слова: картинка (если включены) и исправить перевод. */
export function leechKeyboard(wordId: number, withPicture: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (withPicture) kb.text("🖼 Картинка", encodeCb({ k: "picture", wordId }));
  return kb.text("✏️ Изменить", encodeCb({ k: "edit", wordId }));
}

export function talkTopicsKeyboard(topics: ReadonlyArray<{ label: string }>): InlineKeyboard {
  const kb = new InlineKeyboard();
  topics.forEach((t, index) => {
    if (index > 0 && index % 2 === 0) kb.row();
    kb.text(t.label, encodeCb({ k: "talkTopic", index }));
  });
  return kb;
}

export function talkEndKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🏁 Закончить и разобрать", encodeCb({ k: "talkEnd" }));
}

export function sayKeyboard(id: number, learn: Array<{ term: string }>): InlineKeyboard {
  const kb = new InlineKeyboard();
  learn.forEach((item, index) => kb.text(`➕ ${shorten(item.term)}`, encodeCb({ k: "sayAdd", id, index })).row());
  return kb;
}

/** Варианты «сочетаний»; в зачёте — ещё ⚙️, вне зачёта — ⏹. */
export function collocationKeyboard(cardId: number, reps: number, wordId: number, options: string[], practice: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  options.forEach((option, index) => kb.text(option, encodeCb({ k: "collocationPick", cardId, reps, index, practice })));
  kb.row();
  return practice ? kb.text("⏹ Хватит", encodeCb({ k: "practiceStop" })) : addManageButton(kb, wordId);
}

/** Под словами из расширения: отменить каждое (по ошибке кликнул) или исправить. */
export function captureKeyboard(words: Array<{ id: number; term: string }>): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (words.length === 1) {
    return kb.text("↩️ Отменить", encodeCb({ k: "captureUndo", wordId: words[0].id })).text("✏️ Изменить", encodeCb({ k: "edit", wordId: words[0].id }));
  }
  words.forEach((w) => kb.text(`↩️ ${shorten(w.term)}`, encodeCb({ k: "captureUndo", wordId: w.id })).row());
  return kb;
}

export function extensionKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("📦 Скачать расширение", encodeCb({ k: "extensionZip" }))
    .row()
    .text("🔄 Новый ключ", encodeCb({ k: "extensionKey" }));
}

export function translateKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🤷 Не знаю", encodeCb({ k: "translateDunno" })).text("⏹ Хватит", encodeCb({ k: "translateStop" }));
}
