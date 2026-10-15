import { InlineKeyboard } from "grammy";
import type { Room } from "../db/schema";
import type { Batch } from "./batches";
import { encodeCb } from "./callbacks";

export function knowKeyboard(wordId: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Знаю", encodeCb({ k: "know", wordId, knows: true }))
    .text("📚 Не знаю", encodeCb({ k: "know", wordId, knows: false }));
}

export function showKeyboard(cardId: number, reps: number): InlineKeyboard {
  return new InlineKeyboard().text("👀 Показать", encodeCb({ k: "show", cardId, reps }));
}

export function rateKeyboard(cardId: number, reps: number, isNew: boolean): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text("😵 Забыл", encodeCb({ k: "rate", cardId, reps, answer: "again" }))
    .text("😐 С трудом", encodeCb({ k: "rate", cardId, reps, answer: "hard" }))
    .text("😎 Помню", encodeCb({ k: "rate", cardId, reps, answer: "good" }));
  if (isNew) kb.row().text("✅ Уже знаю", encodeCb({ k: "rate", cardId, reps, answer: "easy" }));
  return kb;
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

export function batchKeyboard(batch: Batch): InlineKeyboard {
  const kb = new InlineKeyboard();
  batch.items.forEach((item, index) => {
    const mark = batch.selected[index] ? "✅" : "⬜️";
    kb.text(shorten(`${mark} ${item.term} — ${item.translation}`), encodeCb({ k: "batchToggle", id: batch.id, index })).row();
  });
  return kb
    .text(`✅ Добавить (${batch.selectedItems().length})`, encodeCb({ k: "batch", id: batch.id, action: "add" }))
    .text("🔍 По одному", encodeCb({ k: "batch", id: batch.id, action: "review" }))
    .row()
    .text("❌ Отмена", encodeCb({ k: "batch", id: batch.id, action: "cancel" }));
}

export function roomKeyboard(otherRooms: Room[], hasCurrent: boolean): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (hasCurrent) kb.text("🔗 Пригласить", encodeCb({ k: "room", action: "invite" }));
  kb.text("➕ Новая комната", encodeCb({ k: "room", action: "new" }));
  for (const room of otherRooms) kb.row().text(`→ ${room.name}`, encodeCb({ k: "roomsw", roomId: room.id }));
  return kb;
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
