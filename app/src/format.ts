/** Кружок полезности — как в боте: 🟢 очень полезное, 🟡 полезное, ⚪️ необязательное. */
export const USEFULNESS = { 3: "🟢", 2: "🟡", 1: "⚪️" } as Record<number, string>;

export function transcription(w: { transcriptionUk: string; transcriptionUs: string }): string {
  const uk = w.transcriptionUk.trim();
  const us = w.transcriptionUs.trim();
  if (uk && uk === us) return uk;
  return [uk && `🇬🇧 ${uk}`, us && `🇺🇸 ${us}`].filter(Boolean).join("  ·  ");
}
