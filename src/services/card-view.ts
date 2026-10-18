/** Что показывать на карточке в /learn — у каждого своё. Перевод показывается всегда. */
export const CARD_PARTS = ["transcription", "explanation", "example", "context", "mnemonic", "audio", "picture"] as const;
export type CardPart = (typeof CARD_PARTS)[number];
export type CardView = Record<CardPart, boolean>;

export const ALL_PARTS: CardView = {
  transcription: true,
  explanation: true,
  example: true,
  context: true,
  mnemonic: true,
  audio: true,
  picture: true,
};

const parse = (hidden: string) => new Set(hidden.split(",").filter(Boolean));

/** users.card_hidden — список скрытых частей через запятую ("" — показывать всё). */
export function cardView(user: { cardHidden: string }): CardView {
  const hidden = parse(user.cardHidden);
  return Object.fromEntries(CARD_PARTS.map((p) => [p, !hidden.has(p)])) as CardView;
}

export function toggleCardPart(hidden: string, part: CardPart): string {
  const set = parse(hidden);
  if (set.has(part)) set.delete(part);
  else set.add(part);
  return CARD_PARTS.filter((p) => set.has(p)).join(",");
}
