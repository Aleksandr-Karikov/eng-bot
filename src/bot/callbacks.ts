import { CARD_PARTS, type CardPart } from "../services/card-view";
import { STAGES, type Stage } from "../services/exercises";
import type { Answer } from "../srs/srs";

export const NEXT_AFTER = ["learn", "practice", "drill"] as const;
export type NextAfter = (typeof NEXT_AFTER)[number];

export type Cb =
  | { k: "know"; wordId: number; knows: boolean }
  | { k: "show"; cardId: number; reps: number }
  | { k: "rate"; cardId: number; reps: number; answer: Answer; stage?: Stage }
  | { k: "learn" }
  | { k: "practiceStart" }
  | { k: "practiceRate"; cardId: number; remembered: boolean }
  | { k: "practiceDunno"; cardId: number }
  | { k: "practiceStop" }
  /** «▶ Дальше» под разбором ответа: что показать следом — карточку /learn, тренировку или вопрос /drill. */
  | { k: "next"; then: NextAfter }
  /** «↩️ Отменить»: последний ответ по этой карточке. */
  | { k: "undo"; cardId: number; stage?: Stage }
  /** 🎧 Аудиоурок с выбранным акцентом. */
  | { k: "lesson"; accent: "uk" | "us" | "mix" }
  | { k: "duel"; roundId: number; index: number }
  | { k: "dunno"; cardId: number; reps: number }
  | { k: "mode"; stage: Stage }
  | { k: "drillPick"; qid: number; index: number }
  | { k: "drillMode" }
  | { k: "notifyDue" }
  | { k: "weeklyReport" }
  | { k: "cardPart"; part: CardPart }
  | { k: "mistakesClear" }
  | { k: "mistakesSave"; id: number; save: boolean }
  | { k: "draft"; id: number; action: "ok" | "edit" | "cancel" | "skip" | "stop" }
  | { k: "batchToggle"; id: number; index: number }
  | { k: "batch"; id: number; action: "add" | "review" | "cancel" }
  | { k: "batchPage"; id: number; page: number }
  | { k: "edit"; wordId: number }
  | { k: "mnemonic"; wordId: number }
  | { k: "picture"; wordId: number }
  | { k: "redraw"; wordId: number }
  | { k: "manage"; wordId: number; open: boolean }
  | { k: "storyAudio"; id: number }
  | { k: "talkTopic"; index: number }
  | { k: "talkEnd" }
  | { k: "pronListen"; accent: "uk" | "us" }
  | { k: "captureUndo"; wordId: number }
  | { k: "promote"; wordId: number }
  | { k: "settingsScreen"; screen: "main" | "remind" | "modes" | "card" }
  | { k: "mistakesGo"; to: "drill" | "translate" }
  | { k: "notForMe"; wordId: number; from: "know" | "learn" }
  | { k: "restoreCard"; wordId: number }
  | { k: "translateStop" }
  | { k: "translateDunno" }
  | { k: "translateNext" }
  | { k: "extensionKey" }
  | { k: "extensionZip" }
  | { k: "collocationPick"; cardId: number; reps: number; index: number; practice: boolean }
  | { k: "sayAdd"; id: number; index: number }
  | { k: "storyAnswer"; id: number; q: number; index: number }
  | { k: "redrawAs"; wordId: number; how: "again" | "custom" | number }
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
/** Какое упражнение было показано — для статистики ответов. */
const STAGE_CODES: Record<Stage, string> = { en_ru: "e", ru_en: "r", cloze: "c", sentence: "s", listen: "l", collocation: "o" };
const DRAFT_ACTIONS = { o: "ok", e: "edit", c: "cancel", s: "skip", x: "stop" } as const;
const BATCH_ACTIONS = { a: "add", r: "review", c: "cancel" } as const;
const ROOM_ACTIONS = { n: "new", i: "invite" } as const;

const short = <T extends string>(map: Record<string, T>, value: T) =>
  Object.keys(map).find((key) => map[key] === value)!;

export function encodeCb(cb: Cb): string {
  switch (cb.k) {
    case "know": return `k:${cb.wordId}:${cb.knows ? "y" : "n"}`;
    case "show": return `s:${cb.cardId}:${cb.reps}`;
    case "rate": return `r:${cb.cardId}:${cb.reps}:${short(ANSWERS, cb.answer)}${cb.stage ? `:${STAGE_CODES[cb.stage]}` : ""}`;
    case "learn": return "l";
    case "practiceStart": return "px";
    case "practiceRate": return `pr:${cb.cardId}:${cb.remembered ? "g" : "a"}`;
    case "practiceDunno": return `pu:${cb.cardId}`;
    case "practiceStop": return "pz";
    case "next": return `nx:${cb.then[0]}`;
    case "lesson": return `ls:${cb.accent}`;
    case "undo": return `ud:${cb.cardId}${cb.stage ? `:${STAGE_CODES[cb.stage]}` : ""}`;
    case "duel": return `dv:${cb.roundId}:${cb.index}`;
    case "dunno": return `u:${cb.cardId}:${cb.reps}`;
    case "mode": return `m:${cb.stage}`;
    case "drillPick": return `q:${cb.qid}:${cb.index}`;
    case "drillMode": return "md";
    case "notifyDue": return "nd";
    case "weeklyReport": return "wr";
    case "cardPart": return `cv:${cb.part}`;
    case "mistakesClear": return "mz";
    case "mistakesSave": return `mk:${cb.id}:${cb.save ? "y" : "n"}`;
    case "draft": return `d:${cb.id}:${short(DRAFT_ACTIONS, cb.action)}`;
    case "batchToggle": return `bt:${cb.id}:${cb.index}`;
    case "batch": return `b:${cb.id}:${short(BATCH_ACTIONS, cb.action)}`;
    case "batchPage": return `bp:${cb.id}:${cb.page}`;
    case "edit": return `e:${cb.wordId}`;
    case "mnemonic": return `mn:${cb.wordId}`;
    case "picture": return `im:${cb.wordId}`;
    case "redraw": return `rd:${cb.wordId}`;
    case "storyAudio": return `sa:${cb.id}`;
    case "talkTopic": return `tt:${cb.index}`;
    case "talkEnd": return "te";
    case "pronListen": return `pl:${cb.accent}`;
    case "captureUndo": return `cu:${cb.wordId}`;
    case "promote": return `uf:${cb.wordId}`;
    case "settingsScreen": return `ss:${cb.screen}`;
    case "mistakesGo": return `mg:${cb.to === "drill" ? "d" : "t"}`;
    case "notForMe": return `nf:${cb.wordId}:${cb.from === "know" ? "k" : "l"}`;
    case "restoreCard": return `nr:${cb.wordId}`;
    case "translateStop": return "tz";
    case "translateDunno": return "tu";
    case "translateNext": return "tn";
    case "extensionKey": return "ek";
    case "extensionZip": return "ez";
    case "collocationPick": return `co:${cb.cardId}:${cb.reps}:${cb.index}${cb.practice ? ":p" : ""}`;
    case "sayAdd": return `sy:${cb.id}:${cb.index}`;
    case "storyAnswer": return `sq:${cb.id}:${cb.q}:${cb.index}`;
    case "manage": return `wm:${cb.wordId}${cb.open ? "" : ":c"}`;
    case "redrawAs": return `rv:${cb.wordId}:${cb.how === "again" ? "x" : cb.how === "custom" ? "c" : cb.how}`;
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
  const [tag, a, b, c, d] = data.split(":");
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
      const stage = STAGES.find((s) => STAGE_CODES[s] === d);
      if (cardId === null || reps === null || !answer) return null;
      return stage ? { k: "rate", cardId, reps, answer, stage } : { k: "rate", cardId, reps, answer };
    }
    case "l": return { k: "learn" };
    case "px": return { k: "practiceStart" };
    case "pz": return { k: "practiceStop" };
    case "ls": return a === "uk" || a === "us" || a === "mix" ? { k: "lesson", accent: a } : null;
    case "ud": {
      const cardId = int(a);
      const stage = STAGES.find((s) => STAGE_CODES[s] === b);
      if (cardId === null) return null;
      return stage ? { k: "undo", cardId, stage } : { k: "undo", cardId };
    }
    case "nx": {
      const then = NEXT_AFTER.find((n) => n[0] === a);
      return then ? { k: "next", then } : null;
    }
    case "pr": {
      const cardId = int(a);
      return cardId !== null && (b === "g" || b === "a") ? { k: "practiceRate", cardId, remembered: b === "g" } : null;
    }
    case "pu": {
      const cardId = int(a);
      return cardId !== null ? { k: "practiceDunno", cardId } : null;
    }
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
    case "nd": return { k: "notifyDue" };
    case "wr": return { k: "weeklyReport" };
    case "cv": return (CARD_PARTS as readonly string[]).includes(a ?? "") ? { k: "cardPart", part: a as CardPart } : null;
    case "mz": return { k: "mistakesClear" };
    case "mk": {
      const id = int(a);
      return id !== null && (b === "y" || b === "n") ? { k: "mistakesSave", id, save: b === "y" } : null;
    }
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
    case "rd": {
      const wordId = int(a);
      return wordId !== null ? { k: "redraw", wordId } : null;
    }
    case "tt": {
      const index = int(a);
      return index !== null ? { k: "talkTopic", index } : null;
    }
    case "te": return { k: "talkEnd" };
    case "pl": return a === "uk" || a === "us" ? { k: "pronListen", accent: a } : null;
    case "ek": return { k: "extensionKey" };
    case "ez": return { k: "extensionZip" };
    case "tz": return { k: "translateStop" };
    case "tu": return { k: "translateDunno" };
    case "tn": return { k: "translateNext" };
    case "nf": {
      const wordId = int(a);
      return wordId !== null && (b === "k" || b === "l") ? { k: "notForMe", wordId, from: b === "k" ? "know" : "learn" } : null;
    }
    case "nr": {
      const wordId = int(a);
      return wordId !== null ? { k: "restoreCard", wordId } : null;
    }
    case "ss": return a === "main" || a === "remind" || a === "modes" || a === "card" ? { k: "settingsScreen", screen: a } : null;
    case "mg": return a === "d" || a === "t" ? { k: "mistakesGo", to: a === "d" ? "drill" : "translate" } : null;
    case "uf": {
      const wordId = int(a);
      return wordId !== null ? { k: "promote", wordId } : null;
    }
    case "cu": {
      const wordId = int(a);
      return wordId !== null ? { k: "captureUndo", wordId } : null;
    }
    case "co": {
      const cardId = int(a), reps = int(b), index = int(c);
      if (cardId === null || reps === null || index === null || (d !== undefined && d !== "p")) return null;
      return { k: "collocationPick", cardId, reps, index, practice: d === "p" };
    }
    case "sy": {
      const id = int(a), index = int(b);
      return id !== null && index !== null ? { k: "sayAdd", id, index } : null;
    }
    case "sa": {
      const id = int(a);
      return id !== null ? { k: "storyAudio", id } : null;
    }
    case "sq": {
      const id = int(a), q = int(b), index = int(c);
      return id !== null && q !== null && index !== null ? { k: "storyAnswer", id, q, index } : null;
    }
    case "wm": {
      const wordId = int(a);
      return wordId !== null && (b === undefined || b === "c") ? { k: "manage", wordId, open: b === undefined } : null;
    }
    case "rv": {
      const wordId = int(a), style = int(b);
      if (wordId === null) return null;
      if (b === "x") return { k: "redrawAs", wordId, how: "again" };
      if (b === "c") return { k: "redrawAs", wordId, how: "custom" };
      return style !== null ? { k: "redrawAs", wordId, how: style } : null;
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
