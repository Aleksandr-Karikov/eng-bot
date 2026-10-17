import { InlineKeyboard } from "grammy";
import type { Room, User } from "../db/schema";
import type { DrillQuestion } from "../llm/tutor";
import type { Stage } from "../services/exercises";
import type { Batch } from "./batches";
import type { Picker } from "./pickers";
import { encodeCb } from "./callbacks";

export function knowKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Знаю", encodeCb({ k: "know", wordId, knows: true }))
    .text("📚 Не знаю", encodeCb({ k: "know", wordId, knows: false }));
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
export function rateKeyboard(cardId: number, reps: number, isNew: boolean, wordId: number, withAudio = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("😵 Забыл", encodeCb({ k: "rate", cardId, reps, answer: "again" }))
    .text("😎 Помню", encodeCb({ k: "rate", cardId, reps, answer: "good" }));
  if (isNew) kb.row().text("✅ Уже знаю", encodeCb({ k: "rate", cardId, reps, answer: "easy" }));
  kb.row();
  if (withAudio) addAudioRow(kb, wordId);
  return kb.text("✏️ Изменить", encodeCb({ k: "edit", wordId })).text("🗑 Удалить", encodeCb({ k: "del", wordId }));
}

export function learnKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("▶️ Начать", encodeCb({ k: "learn" }));
}

export function draftKeyboard(id: number, inBatch = false): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("✅ Ок", encodeCb({ k: "draft", id, action: "ok" }))
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
    kb.text(shorten(`${mark} ${item.term} — ${item.translation}`), encodeCb({ k: "batchToggle", id: batch.id, index })).row();
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

export function wordActionsKeyboard(wordId: number): InlineKeyboard {
  return addAudioRow(new InlineKeyboard(), wordId)
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
  return new InlineKeyboard()
    .text("🤷 Не знаю", encodeCb({ k: "dunno", cardId, reps }))
    .row()
    .text("✏️ Изменить", encodeCb({ k: "edit", wordId }))
    .text("🗑 Удалить", encodeCb({ k: "del", wordId }));
}

const MODE_LABELS: Array<[Stage, string, keyof User]> = [
  ["en_ru", "EN → RU", "modeEnRu"],
  ["ru_en", "RU → EN", "modeRuEn"],
  ["cloze", "Вставь по смыслу", "modeCloze"],
];

/** Часы напоминания + переключатели режимов тренажёра. */
export function settingsKeyboard(user: User): InlineKeyboard {
  const kb = hoursKeyboard().row();
  for (const [stage, label, field] of MODE_LABELS) {
    kb.text(`${user[field] ? "✅" : "⬜️"} ${label}`, encodeCb({ k: "mode", stage })).row();
  }
  return kb.text(`${user.modeDrill ? "✅" : "⬜️"} 🧠 Работа над ошибками`, encodeCb({ k: "drillMode" }));
}

/** qid — номер показа вопроса: старые кнопки не должны оценивать другой, текущий вопрос. */
export function drillKeyboard(q: DrillQuestion, qid: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  q.options.forEach((option, index) => kb.text(shorten(option), encodeCb({ k: "drillPick", qid, index })).row());
  return kb;
}

export function mistakesKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🗑 Сбросить", encodeCb({ k: "mistakesClear" }));
}
