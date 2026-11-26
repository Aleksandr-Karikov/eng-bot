import type { BossId } from "../../src/boss-opponents";

const PROPS: Record<BossId, string[]> = {
  dragon: ["duel-pillar", "duel-ballista"],
  sentinel: ["duel-mirror"],
  frost: ["duel-crystal", "duel-ice-rock"],
};

const images = new Map<string, { image: HTMLImageElement; ready: Promise<void> }>();

export const arenaArt = (name: string) => `${import.meta.env.BASE_URL}arena/${name}.webp`;

function prepareImage(name: string, previewOnly: boolean): Promise<void> {
  const existing = images.get(name);
  if (existing) {
    if (!previewOnly) existing.image.fetchPriority = "auto";
    return existing.ready;
  }
  const image = new Image();
  image.fetchPriority = previewOnly ? "low" : "auto";
  image.src = arenaArt(name);
  const ready = (image.decode?.() ?? Promise.resolve()).catch(() => { images.delete(name); });
  images.set(name, { image, ready });
  return ready;
}

export function preloadArenaArt(opponent: BossId, previewOnly = false) {
  const names = [opponent, `${opponent}-hall`];
  if (!previewOnly) names.push("duel-hero", ...PROPS[opponent]);
  return Promise.all(names.map((name) => prepareImage(name, previewOnly)));
}

export async function waitForArenaArt(opponent: BossId): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([preloadArenaArt(opponent), new Promise<void>((resolve) => { timer = setTimeout(resolve, 700); })]);
  } finally {
    clearTimeout(timer);
  }
}
