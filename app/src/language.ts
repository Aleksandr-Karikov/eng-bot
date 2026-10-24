/**
 * Изучаемый язык текущей комнаты — приходит в /api/me. До ответа — английский, как было всегда.
 * Меняет подписи: кнопки озвучки (у корейского одна), транскрипцию, «вспомни по-английски».
 */
export interface StudyLanguage {
  code: "en" | "ko";
  flag: string;
  accents: Array<{ key: "uk" | "us"; label: string }>;
  /** «по-английски» */
  adv: string;
  /** «английское» (слово) */
  neut: string;
}

let current: StudyLanguage = {
  code: "en",
  flag: "🇬🇧",
  accents: [
    { key: "uk", label: "🇬🇧 UK" },
    { key: "us", label: "🇺🇸 US" },
  ],
  adv: "по-английски",
  neut: "английское",
};

export const studyLanguage = () => current;

export function setStudyLanguage(lang: StudyLanguage | undefined): void {
  if (lang) current = lang;
}
