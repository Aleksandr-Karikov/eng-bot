import { currentLang, type Language } from "../lang";

/**
 * Озвучка карточек в Mini App. В боте звук всегда по нажатию кнопки — там настройки нет.
 *
 * `users.voice_accent` — какой вариант произношения играть самому при показе карточки:
 * "uk" / "us" (включено и выбран этот) или "" (выключено — как было раньше). Отдельного флага
 * «включено» нет: пустая строка и есть «выключено», иначе пришлось бы держать два поля в согласии.
 */
export type VoiceAccent = "uk" | "us";

export const VOICE_ACCENTS: readonly VoiceAccent[] = ["uk", "us"];

/**
 * Вариант, который включается сам у всех, кто ничего не выбирал: британский — первый в списке
 * вариантов языка (`LANGUAGES[*].accents`). Совпадает с `default("uk")` колонки `users.voice_accent`
 * в схеме — эти два места обязаны называть один и тот же вариант.
 */
export const DEFAULT_VOICE_ACCENT: VoiceAccent = "uk";

/** Вариант произношения, который играть самому; undefined — озвучка выключена. */
export function autoVoice(user: { voiceAccent: string }, lang: Language = currentLang()): VoiceAccent | undefined {
  return lang.accents.find((a) => a === user.voiceAccent);
}

/**
 * Что записать в `voice_accent` по нажатию «🔊 UK / 🔊 US» или «Выключить» в настройках.
 * Повторное нажатие на выбранный вариант выключает озвучку — как переключатель.
 */
export function toggleVoiceAccent(current: string, pick: VoiceAccent | "off"): string {
  return pick === "off" || current === pick ? "" : pick;
}

/** Подпись выбранного варианта для настроек: «🇬🇧 UK», «🇺🇸 US» или «выключена». */
export function voiceLabel(user: { voiceAccent: string }, lang: Language = currentLang()): string {
  const accent = autoVoice(user, lang);
  return accent ? lang.accentLabel[accent] : "выключена";
}
