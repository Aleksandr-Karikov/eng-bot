import { InlineKeyboard } from "grammy";
import type { Room } from "../db/schema";
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

export function draftKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Ок", encodeCb({ k: "draft", id, action: "ok" }))
    .text("✏️ Исправить", encodeCb({ k: "draft", id, action: "edit" }))
    .text("❌ Отмена", encodeCb({ k: "draft", id, action: "cancel" }));
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
