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

/** Пишет в лог вызовы Telegram API дольше thresholdMs — чтобы отличать медленную сеть от медленного кода. */
export function slowApiCallLogger(thresholdMs: number, log: (line: string) => void = console.warn): Transformer {
  return async (prev, method, payload, signal) => {
    const started = Date.now();
    const res = await prev(method, payload, signal);
    const ms = Date.now() - started;
    // getUpdates — long polling, он и должен висеть подолгу.
    if (ms > thresholdMs && method !== "getUpdates") log(`Telegram ${method} took ${ms} ms`);
    return res;
  };
}
