import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Язык, который учат в комнате. Интерфейс бота всегда русский; меняется изучаемый язык — в промптах,
 * транскрипции, озвучке, подписях. Английский — как было до появления языков, корейский — второй.
 */
export type LangCode = "en" | "ko";

export const LANG_CODES: LangCode[] = ["en", "ko"];

export interface Language {
  code: LangCode;
  flag: string;
  /** «английский» — для текстов бота. */
  name: string;
  /**
   * Основа прилагательного: «английск» → английский, английское, английского, на английском, по-английски.
   * У «корейский» те же окончания — так промпты меняют язык подстановкой основы, а английский текст не меняется.
   */
  stem: string;
  /** Варианты произношения: у английского — британский и американский, у корейского один (хранится в слоте uk). */
  accents: Array<"uk" | "us">;
  /** Подпись варианта на кнопке озвучки и у транскрипции. */
  accentLabel: Record<"uk" | "us", string>;
  /** Голос macOS для озвучки (у английского — Kokoro, если поставлен). */
  macVoice: Record<"uk" | "us", string>;
  /** Код языка для Whisper. */
  whisper: string;
  /** Есть ли в тексте буквы этого языка: без них русское слово — просьба подобрать эквивалент. */
  script: RegExp;
}

export const LANGUAGES: Record<LangCode, Language> = {
  en: {
    code: "en",
    flag: "🇬🇧",
    name: "английский",
    stem: "английск",
    accents: ["uk", "us"],
    accentLabel: { uk: "🇬🇧 UK", us: "🇺🇸 US" },
    macVoice: { uk: "Daniel", us: "Samantha" },
    whisper: "en",
    script: /[a-z]/i,
  },
  ko: {
    code: "ko",
    flag: "🇰🇷",
    name: "корейский",
    stem: "корейск",
    accents: ["uk"],
    accentLabel: { uk: "🇰🇷", us: "🇰🇷" },
    macVoice: { uk: "Yuna", us: "Yuna" },
    whisper: "ko",
    script: /[ㄱ-ㆎ가-힣]/,
  },
};

export const EN = LANGUAGES.en;

export function isLangCode(value: unknown): value is LangCode {
  return typeof value === "string" && (LANG_CODES as string[]).includes(value);
}

export function languageOf(code: string | null | undefined): Language {
  return isLangCode(code) ? LANGUAGES[code] : EN;
}

/** «английск» → «Английск»: для начала предложения в промптах. */
export const capStem = (lang: Language) => lang.stem[0].toUpperCase() + lang.stem.slice(1);

/**
 * Язык текущей операции (апдейта бота, запроса приложения, фоновой задачи по слову) — чтобы не протаскивать
 * его параметром через все обработчики. Ставит его тот, кто знает комнату: middleware бота, API приложения,
 * генераторы по слову. Вне такого контекста — английский, как было всегда.
 */
const current = new AsyncLocalStorage<LangCode>();

export function currentLang(): Language {
  return LANGUAGES[current.getStore() ?? "en"];
}

export function withLang<T>(code: LangCode, fn: () => T): T {
  return current.run(code, fn);
}

/** Название языка в нужной форме — для текстов бота: для английского строки остаются прежними. */
export const langForms = (lang: Language = currentLang()) => ({
  /** по-английски */
  adv: `по-${lang.stem}и`,
  /** на английском */
  prep: `на ${lang.stem}ом`,
  /** английский (что? на что?) */
  acc: `${lang.stem}ий`,
  /** английское (слово) */
  neut: `${lang.stem}ое`,
  /** английского */
  gen: `${lang.stem}ого`,
  /** английских (субтитров) */
  genPl: `${lang.stem}их`,
});

/** Случайный вариант произношения языка (у корейского он один). */
export function pickAccent(random: () => number, lang: Language = currentLang()): "uk" | "us" {
  return lang.accents.length === 1 ? lang.accents[0] : random() < 0.5 ? "uk" : "us";
}
