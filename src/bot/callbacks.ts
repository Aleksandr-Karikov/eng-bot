import { CARD_PARTS, type CardPart } from "../services/card-view";
import { STAGES, type Stage } from "../services/exercises";
import type { Answer } from "../srs/srs";

export type Cb =
  | { k: "know"; wordId: number; knows: boolean }
  | { k: "show"; cardId: number; reps: number }
  | { k: "rate"; cardId: number; reps: number; answer: Answer }
  | { k: "learn" }
  | { k: "duel"; roundId: number; index: number }
  | { k: "dunno"; cardId: number; reps: number }
  | { k: "mode"; stage: Stage }
  | { k: "drillPick"; qid: number; index: number }
  | { k: "drillMode" }
  | { k: "cardPart"; part: CardPart }
  | { k: "mistakesClear" }
  | { k: "draft"; id: number; action: "ok" | "edit" | "cancel" | "skip" | "stop" }
  | { k: "batchToggle"; id: number; index: number }
  | { k: "batch"; id: number; action: "add" | "review" | "cancel" }
  | { k: "batchPage"; id: number; page: number }
  | { k: "edit"; wordId: number }
  | { k: "mnemonic"; wordId: number }
  | { k: "picture"; wordId: number }
  | { k: "audio"; wordId: number; accent: "uk" | "us" }
  | { k: "del"; wordId: number }
  | { k: "delOk"; wordId: number }
  | { k: "delCancel" }
  | { k: "delBatch"; id: number }
  | { k: "delBatchOk"; id: number }
  | { k: "delPage"; id: number; page: number }
  | { k: "room"; action: "new" | "invite" }
  | { k: "roomsw"; roomId: number }
  | { k: "roomRename"; roomId: number }
  | { k: "roomDel"; roomId: number }
  | { k: "roomDelOk"; roomId: number }
  | { k: "hour"; hour: number };

const ANSWERS: Record<string, Answer> = { a: "again", h: "hard", g: "good", e: "easy" };
const DRAFT_ACTIONS = { o: "ok", e: "edit", c: "cancel", s: "skip", x: "stop" } as const;
const BATCH_ACTIONS = { a: "add", r: "review", c: "cancel" } as const;
const ROOM_ACTIONS = { n: "new", i: "invite" } as const;

const short = <T extends string>(map: Record<string, T>, value: T) =>
  Object.keys(map).find((key) => map[key] === value)!;

export function encodeCb(cb: Cb): string {
  switch (cb.k) {
    case "know": return `k:${cb.wordId}:${cb.knows ? "y" : "n"}`;
    case "show": return `s:${cb.cardId}:${cb.reps}`;
    case "rate": return `r:${cb.cardId}:${cb.reps}:${short(ANSWERS, cb.answer)}`;
    case "learn": return "l";
    case "duel": return `dv:${cb.roundId}:${cb.index}`;
    case "dunno": return `u:${cb.cardId}:${cb.reps}`;
    case "mode": return `m:${cb.stage}`;
    case "drillPick": return `q:${cb.qid}:${cb.index}`;
    case "drillMode": return "md";
    case "cardPart": return `cv:${cb.part}`;
    case "mistakesClear": return "mz";
    case "draft": return `d:${cb.id}:${short(DRAFT_ACTIONS, cb.action)}`;
    case "batchToggle": return `bt:${cb.id}:${cb.index}`;
    case "batch": return `b:${cb.id}:${short(BATCH_ACTIONS, cb.action)}`;
    case "batchPage": return `bp:${cb.id}:${cb.page}`;
    case "edit": return `e:${cb.wordId}`;
    case "mnemonic": return `mn:${cb.wordId}`;
    case "picture": return `im:${cb.wordId}`;
    case "audio": return `a:${cb.wordId}:${cb.accent === "uk" ? "u" : "s"}`;
    case "del": return `x:${cb.wordId}`;
    case "delOk": return `xo:${cb.wordId}`;
    case "delCancel": return "xc";
    case "delBatch": return `xb:${cb.id}`;
    case "delBatchOk": return `xbo:${cb.id}`;
    case "delPage": return `xp:${cb.id}:${cb.page}`;
    case "room": return `rm:${short(ROOM_ACTIONS, cb.action)}`;
    case "roomsw": return `rs:${cb.roomId}`;
    case "roomRename": return `rn:${cb.roomId}`;
    case "roomDel": return `rx:${cb.roomId}`;
    case "roomDelOk": return `rxo:${cb.roomId}`;
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
    case "dv": {
      const roundId = int(a), index = int(b);
      return roundId !== null && index !== null ? { k: "duel", roundId, index } : null;
    }
    case "u": {
      const cardId = int(a), reps = int(b);
      return cardId !== null && reps !== null ? { k: "dunno", cardId, reps } : null;
    }
    case "q": {
      const qid = int(a), index = int(b);
      return qid !== null && index !== null ? { k: "drillPick", qid, index } : null;
    }
    case "md": return { k: "drillMode" };
    case "cv": return (CARD_PARTS as readonly string[]).includes(a ?? "") ? { k: "cardPart", part: a as CardPart } : null;
    case "mz": return { k: "mistakesClear" };
    case "m": return (STAGES as readonly string[]).includes(a ?? "") ? { k: "mode", stage: a as Stage } : null;
    case "d": {
      const id = int(a), action = b ? DRAFT_ACTIONS[b as keyof typeof DRAFT_ACTIONS] : undefined;
      return id !== null && action ? { k: "draft", id, action } : null;
    }
    case "bt": {
      const id = int(a), index = int(b);
      return id !== null && index !== null ? { k: "batchToggle", id, index } : null;
    }
    case "a": {
      const wordId = int(a);
      return wordId !== null && (b === "u" || b === "s") ? { k: "audio", wordId, accent: b === "u" ? "uk" : "us" } : null;
    }
    case "mn":
    case "im": {
      const wordId = int(a);
      return wordId === null ? null : tag === "mn" ? { k: "mnemonic", wordId } : { k: "picture", wordId };
    }
    case "e": {
      const wordId = int(a);
      return wordId !== null ? { k: "edit", wordId } : null;
    }
    case "x":
    case "xo": {
      const wordId = int(a);
      return wordId === null ? null : tag === "x" ? { k: "del", wordId } : { k: "delOk", wordId };
    }
    case "xc": return { k: "delCancel" };
    case "xb":
    case "xbo": {
      const id = int(a);
      return id === null ? null : tag === "xb" ? { k: "delBatch", id } : { k: "delBatchOk", id };
    }
    case "xp": {
      const id = int(a), page = int(b);
      return id !== null && page !== null ? { k: "delPage", id, page } : null;
    }
    case "bp": {
      const id = int(a), page = int(b);
      return id !== null && page !== null ? { k: "batchPage", id, page } : null;
    }
    case "b": {
      const id = int(a), action = b ? BATCH_ACTIONS[b as keyof typeof BATCH_ACTIONS] : undefined;
      return id !== null && action ? { k: "batch", id, action } : null;
    }
    case "rm": {
      const action = a ? ROOM_ACTIONS[a as keyof typeof ROOM_ACTIONS] : undefined;
      return action ? { k: "room", action } : null;
    }
    case "rn": {
      const roomId = int(a);
      return roomId !== null ? { k: "roomRename", roomId } : null;
    }
    case "rx":
    case "rxo": {
      const roomId = int(a);
      return roomId === null ? null : tag === "rx" ? { k: "roomDel", roomId } : { k: "roomDelOk", roomId };
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
