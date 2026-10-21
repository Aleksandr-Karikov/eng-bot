import { retrieveRawInitData } from "@telegram-apps/sdk-react";

export interface Card {
  cardId: number;
  reps: number;
  isNew: boolean;
  stage: "en_ru" | "ru_en";
  word: {
    id: number;
    term: string;
    translation: string;
    explanation: string;
    example: string;
    context: string;
    mnemonic: string;
    transcriptionUk: string;
    transcriptionUs: string;
    usefulness: number | null;
    hasPicture: boolean;
  };
}

export interface Me {
  name: string;
  room: string | null;
  due: { review: number; fresh: number };
}

export type Answer = "again" | "good" | "easy";

function initData(): string {
  try {
    return retrieveRawInitData() ?? "";
  } catch {
    return "";
  }
}

/**
 * Все запросы — с подписанными данными запуска Telegram: по ним бот понимает, кто это.
 * ngrok-skip-browser-warning — иначе бесплатный ngrok отдаёт на запрос свою страницу-предупреждение вместо JSON.
 */
const headers = () => ({ authorization: `tma ${initData()}`, "ngrok-skip-browser-warning": "1" });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { ...init?.headers, ...headers() } });
  if (!res.ok) throw new Error(res.status === 401 ? "Открой приложение из бота" : `Ошибка ${res.status}`);
  return res.json() as Promise<T>;
}

export const getMe = () => call<Me & { ok: true }>("/api/me");
export const getQueue = () => call<{ cards: Card[] }>("/api/queue").then((r) => r.cards);
export const sendAnswer = (card: Card, answer: Answer) =>
  call("/api/answer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cardId: card.cardId, reps: card.reps, answer, stage: card.stage }),
  });

/** Картинка и озвучка тоже под подписью — <img>/<audio> так не умеют, поэтому через fetch и blob-ссылку. */
export async function mediaUrl(path: string): Promise<string | undefined> {
  try {
    const res = await fetch(path, { headers: headers() });
    return res.ok ? URL.createObjectURL(await res.blob()) : undefined;
  } catch {
    return undefined;
  }
}
