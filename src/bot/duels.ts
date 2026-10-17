import type { DuelRound } from "../services/duels";

/** Идущая дуэль в группе. Одна на чат, в памяти. */
export interface Duel {
  roomId: number;
  round: number;
  /** Номер показа раунда — зашит в кнопки, чтобы старые не засчитывались. */
  roundId: number;
  current?: DuelRound;
  messageId?: number;
  lockedOut: Set<number>;
  scores: Map<number, { name: string; points: number }>;
  timer?: ReturnType<typeof setTimeout>;
}

export const DUEL_ROUNDS = 5;

export class DuelStore {
  private readonly duels = new Map<number, Duel>();

  /** roundMs — сколько ждать ответа в раунде. */
  constructor(readonly roundMs = 30_000) {}

  get(chatId: number): Duel | undefined {
    return this.duels.get(chatId);
  }

  start(chatId: number, roomId: number): Duel {
    const duel: Duel = { roomId, round: 0, roundId: 0, lockedOut: new Set(), scores: new Map() };
    this.duels.set(chatId, duel);
    return duel;
  }

  finish(chatId: number): void {
    const duel = this.duels.get(chatId);
    if (duel?.timer) clearTimeout(duel.timer);
    this.duels.delete(chatId);
  }
}
