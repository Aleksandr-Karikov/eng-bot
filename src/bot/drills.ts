import type { DrillQuestion } from "../llm/tutor";

/** Вопросы «работы над ошибками» пользователя: готовые, текущий и где их показывать. В памяти, один набор на пользователя. */
export interface DrillState {
  questions: DrillQuestion[];
  current?: DrillQuestion;
  /** Номер текущего показа — зашит в кнопки вариантов. */
  currentId?: number;
  /** true — запущено через /drill (вопросы подряд), false — подмешиваются в /learn. */
  standalone: boolean;
  /** После какого по счёту ответа в /learn уже показали вопрос — чтобы не показать дважды. */
  lastAtCount: number;
  loading?: Promise<void>;
  /** Если генерация упала или Claude не дал вопросов — не дёргать его снова до этого момента (мс). */
  retryAfter?: number;
}

export class DrillStore {
  private readonly states = new Map<number, DrillState>();

  get(userId: number): DrillState | undefined {
    return this.states.get(userId);
  }

  set(userId: number, state: DrillState): void {
    this.states.set(userId, state);
  }

  delete(userId: number): void {
    this.states.delete(userId);
  }
}
