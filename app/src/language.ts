/**
 * Изучаемый язык — всегда английский: корейский убран целиком (E23).
 *
 * Тип и сеттер оставлены, потому что их читают подписи кнопок озвучки и транскрипции; значения
 * приходят из `/api/me`, но всегда одни и те же.
 */
export interface StudyLanguage {
  code: "en";
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
    { key: "uk", label: "UK" },
    { key: "us", label: "US" },
  ],
  adv: "по-английски",
  neut: "английское",
};

export const studyLanguage = () => current;

export function setStudyLanguage(lang: StudyLanguage | undefined): void {
  if (lang) current = lang;
}
