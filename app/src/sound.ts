import { mediaUrl } from "./api";

/**
 * Озвучка: одна загрузка на звук (кэш blob-ссылок) и подгрузка заранее — иначе каждый тап по 🔊 ждал
 * сервер через туннель, а первый раз ещё и синтез. Готовый звук играет сразу, в том же нажатии
 * (iOS не любит play() после долгого ожидания).
 */
const loading = new Map<string, Promise<string | undefined>>();
const ready = new Map<string, string>();

function load(path: string): Promise<string | undefined> {
  let url = loading.get(path);
  if (!url) {
    url = mediaUrl(path).then((u) => {
      if (u) ready.set(path, u);
      else loading.delete(path); // не вышло — попробуем снова при следующем нажатии
      return u;
    });
    loading.set(path, url);
  }
  return url;
}

export function preloadAudio(path: string): void {
  void load(path);
}

export function playAudio(path: string): void {
  const url = ready.get(path);
  if (url) return void new Audio(url).play().catch(() => {});
  void load(path).then((u) => {
    if (u) void new Audio(u).play().catch(() => {});
  });
}

export const cardAudioPath = (cardId: number, accent: "uk" | "us") => `/api/audio?card=${cardId}&accent=${accent}`;
