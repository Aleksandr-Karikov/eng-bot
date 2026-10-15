import type { Transformer } from "grammy";

/** Ответы Telegram, которые означают «ничего страшного»: поздний тап по кнопке и повторное идентичное редактирование. */
const HARMLESS: Array<{ methods: string[]; text: string }> = [
  { methods: ["answerCallbackQuery"], text: "query is too old" },
  { methods: ["editMessageText", "editMessageReplyMarkup"], text: "message is not modified" },
];

export const ignoreHarmlessErrors: Transformer = async (prev, method, payload, signal) => {
  const res = await prev(method, payload, signal);
  if (!res.ok && HARMLESS.some((h) => h.methods.includes(method) && res.description.includes(h.text))) {
    return { ok: true, result: true } as Awaited<ReturnType<typeof prev>>;
  }
  return res;
};
