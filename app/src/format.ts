import { studyLanguage } from "./language";

/** Кружок полезности — как в боте: 🟢 очень полезное, 🟡 полезное, ⚪️ необязательное. */
export const USEFULNESS = { 3: "🟢", 2: "🟡", 1: "⚪️" } as Record<number, string>;

export function transcription(w: { transcriptionUk: string; transcriptionUs: string }): string {
  // Не английский: в слоте uk — романизация (사랑 → [sa-rang]).
  if (studyLanguage().code !== "en") return w.transcriptionUk.trim() ? `[${w.transcriptionUk.trim().replace(/^[/[\]\s]+|[/[\]\s]+$/g, "")}]` : "";
  const uk = w.transcriptionUk.trim();
  const us = w.transcriptionUs.trim();
  if (uk && uk === us) return uk;
  return [uk && `🇬🇧 ${uk}`, us && `🇺🇸 ${us}`].filter(Boolean).join("  ·  ");
}
