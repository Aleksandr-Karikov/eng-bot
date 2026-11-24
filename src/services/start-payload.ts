/**
 * Откуда человек пришёл в бота. Telegram отдаёт это в `?start=<payload>` — тем, что стоит после
 * `t.me/<bot>?start=`. Раньше разбирался ровно один payload (`join_<code>`), остальные молча
 * превращались в обычное приветствие, и «пришло 40 человек» нельзя было разложить по каналам.
 *
 * Здесь только разбор строки — запись в базу отдельно (`setSourceOnce` в `services/users.ts`),
 * поэтому функция чистая и проверяется без Telegram.
 */

/** Длина, до которой обрезаем незнакомый payload: колонка текстовая, но мусор на килобайт нам не нужен. */
export const MAX_SOURCE = 64;

/** Человек пришёл без ссылки: набрал адрес бота или нашёл его в поиске Telegram. */
export const DIRECT_SOURCE = "direct";

/**
 * Что записать в `users.source` по payload'у из `/start`.
 *
 * - пусто → `direct` (это тоже источник: «пришёл сам» отличается от «пришёл по ссылке»);
 * - `join_<code>` → `join_<code>`: приглашение в комнату, код нужен целиком, чтобы видеть, кто кого зовёт;
 * - `s_<slug>` → `set_<slug>`: переход со страницы набора слов (`/s/<slug>`, раздел 8.2 плана);
 * - всё остальное — как есть, обрезанное: `?start=habr` должен доехать до базы буквально.
 */
export function parseStartPayload(raw: string | undefined): string {
  const payload = (raw ?? "").trim();
  if (!payload) return DIRECT_SOURCE;
  const slug = payload.startsWith("s_") ? `set_${payload.slice(2)}` : payload;
  return slug.slice(0, MAX_SOURCE);
}

/**
 * Ссылка на бота с меткой источника. Нужна там, где мы сами даём человеку ссылку и хотим потом
 * отличить её переходы от остальных (страницы наборов, приглашения).
 */
export function startLink(botUsername: string, payload: string): string {
  return `https://t.me/${botUsername}?start=${encodeURIComponent(parseStartPayload(payload))}`;
}
