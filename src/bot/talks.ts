import type { Accent } from "../speech/tts";

/** Разговор /talk: тема, слова комнаты, которые стоит вплести, и реплики. В памяти, один на пользователя. */
export interface TalkLine {
  who: "user" | "bot";
  text: string;
}

export interface Talk {
  topic: string;
  words: Array<{ term: string; translation: string }>;
  lines: TalkLine[];
  chatId: number;
  /** Каким акцентом собеседник отвечает голосом. */
  accent: Accent;
  /** Ученик хоть раз ответил голосовым — дальше собеседник тоже отвечает голосом. */
  voice?: boolean;
  lastAt: number;
}

/** Брошенный разговор через полчаса уже не перехватывает обычные сообщения. */
const TALK_TTL_MS = 30 * 60_000;
/** Дальше история не помещается в разумный промпт — пора разбирать. */
export const MAX_TALK_TURNS = 30;

export class TalkStore {
  private readonly talks = new Map<number, Talk>();

  start(userId: number, talk: Omit<Talk, "lastAt">): Talk {
    const fresh = { ...talk, lastAt: Date.now() };
    this.talks.set(userId, fresh);
    return fresh;
  }

  get(userId: number): Talk | undefined {
    const talk = this.talks.get(userId);
    if (talk && Date.now() - talk.lastAt > TALK_TTL_MS) {
      this.talks.delete(userId);
      return undefined;
    }
    return talk;
  }

  touch(talk: Talk): void {
    talk.lastAt = Date.now();
  }

  end(userId: number): Talk | undefined {
    const talk = this.talks.get(userId);
    this.talks.delete(userId);
    return talk;
  }
}
