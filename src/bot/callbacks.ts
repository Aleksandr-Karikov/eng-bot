import type { Answer } from "../srs/srs";

export type Cb =
  | { k: "know"; wordId: number; knows: boolean }
  | { k: "show"; cardId: number; reps: number }
  | { k: "rate"; cardId: number; reps: number; answer: Answer }
  | { k: "learn" }
  | { k: "draft"; id: number; action: "ok" | "edit" | "cancel" }
  | { k: "room"; action: "new" | "invite" }
  | { k: "roomsw"; roomId: number }
  | { k: "hour"; hour: number };

const ANSWERS: Record<string, Answer> = { a: "again", h: "hard", g: "good", e: "easy" };
const DRAFT_ACTIONS = { o: "ok", e: "edit", c: "cancel" } as const;
const ROOM_ACTIONS = { n: "new", i: "invite" } as const;

const short = <T extends string>(map: Record<string, T>, value: T) =>
  Object.keys(map).find((key) => map[key] === value)!;

export function encodeCb(cb: Cb): string {
  switch (cb.k) {
    case "know": return `k:${cb.wordId}:${cb.knows ? "y" : "n"}`;
    case "show": return `s:${cb.cardId}:${cb.reps}`;
    case "rate": return `r:${cb.cardId}:${cb.reps}:${short(ANSWERS, cb.answer)}`;
    case "learn": return "l";
    case "draft": return `d:${cb.id}:${short(DRAFT_ACTIONS, cb.action)}`;
    case "room": return `rm:${short(ROOM_ACTIONS, cb.action)}`;
    case "roomsw": return `rs:${cb.roomId}`;
    case "hour": return `t:${cb.hour}`;
  }
}

const int = (s: string | undefined): number | null => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

export function decodeCb(data: string): Cb | null {
  const [tag, a, b, c] = data.split(":");
  switch (tag) {
    case "k": {
      const wordId = int(a);
      return wordId !== null && (b === "y" || b === "n") ? { k: "know", wordId, knows: b === "y" } : null;
    }
    case "s": {
      const cardId = int(a), reps = int(b);
      return cardId !== null && reps !== null ? { k: "show", cardId, reps } : null;
    }
    case "r": {
      const cardId = int(a), reps = int(b), answer = c ? ANSWERS[c] : undefined;
      return cardId !== null && reps !== null && answer ? { k: "rate", cardId, reps, answer } : null;
    }
    case "l": return { k: "learn" };
    case "d": {
      const id = int(a), action = b ? DRAFT_ACTIONS[b as keyof typeof DRAFT_ACTIONS] : undefined;
      return id !== null && action ? { k: "draft", id, action } : null;
    }
    case "rm": {
      const action = a ? ROOM_ACTIONS[a as keyof typeof ROOM_ACTIONS] : undefined;
      return action ? { k: "room", action } : null;
    }
    case "rs": {
      const roomId = int(a);
      return roomId !== null ? { k: "roomsw", roomId } : null;
    }
    case "t": {
      const hour = int(a);
      return hour !== null && hour < 24 ? { k: "hour", hour } : null;
    }
    default: return null;
  }
}
