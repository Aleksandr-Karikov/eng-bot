import { studyLanguage } from "./language";

export const hpFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

/**
 * Полезность слова — словами, а не эмодзи-кружком: в интерфейсе она рисуется точкой (icons.tsx),
 * а в разборе правки нужен текст.
 */
export function usefulnessText(level: number | null | undefined): string {
  if (level === 3) return "очень полезное";
  if (level === 2) return "полезное";
  if (level === 1) return "необязательное";
  return "пока не оценена";
}

export function transcription(w: { transcriptionUk: string; transcriptionUs: string }): string {
  // Не английский: в слоте uk — романизация (사랑 → [sa-rang]).
  if (studyLanguage().code !== "en") return w.transcriptionUk.trim() ? `[${w.transcriptionUk.trim().replace(/^[/[\]\s]+|[/[\]\s]+$/g, "")}]` : "";
  const uk = w.transcriptionUk.trim();
  const us = w.transcriptionUs.trim();
  if (uk && uk === us) return uk;
  // Варианты подписаны коротко — UK и US, как на кнопках озвучки: флаги в тексте читались как эмодзи.
  return [uk && `UK ${uk}`, us && `US ${us}`].filter(Boolean).join("  ·  ");
}
