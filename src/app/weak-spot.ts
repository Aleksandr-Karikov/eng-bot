import { randomUUID } from "node:crypto";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { bossEnabled } from "../services/boss";
import { attackWithReserve } from "../services/combat";
import { buildDuelRound, type DuelRound } from "../services/duels";
import { isMember } from "../services/rooms";
import { appBoss } from "./api";

type Question = DuelRound & {
  id: string;
  roomId: number;
  week: string;
  round: number;
  expiresAt: number;
  spend: number;
  damage: number;
};

const EXPIRED = { status: 409 as const, body: { ok: false, error: "Окно атаки закрылось. Обнови бой." } };
const QUESTION_TTL_MS = 5 * 60_000;

export class AppWeakSpot {
  private readonly questions = new Map<number, Question>();

  constructor(private readonly deps: Deps) {}

  async open(user: User) {
    const { db, now, random } = this.deps;
    const roomId = user.currentRoomId;
    if (roomId == null || !(await isMember(db, roomId, user.id))) return EXPIRED;
    const arena = await appBoss(this.deps, user);
    if (!arena.boss) return EXPIRED;
    const { boss, combat } = arena;
    if (!combat.weakSpot) return EXPIRED;
    const at = now().getTime();
    for (const [userId, question] of this.questions) {
      if (question.expiresAt <= at) this.questions.delete(userId);
    }
    let question = this.questions.get(user.id);
    if (question?.roomId !== roomId || question.week !== boss.week || question.round !== boss.round) {
      const round = await buildDuelRound(db, roomId, random, user.id);
      if (!round) return {
        status: 409 as const,
        body: { ok: false, error: "Для вопроса нужны четыре разных перевода в комнате и хотя бы одно слово, которое ты уже повторял." },
      };
      question = { ...round, ...combat.weakSpot, id: randomUUID(), roomId, week: boss.week, round: boss.round, expiresAt: at + QUESTION_TTL_MS };
      this.questions.set(user.id, question);
    }
    const { id, term, options, spend, damage } = question;
    return { status: 200 as const, body: { ok: true, question: { id, term, options, spend, damage } } };
  }

  async answer(user: User, body: { id?: unknown; choice?: unknown }) {
    const { db, bossEnabled: enabled, now } = this.deps;
    const question = this.questions.get(user.id);
    if (!bossEnabled(user, enabled) || !question || body.id !== question.id || question.expiresAt <= now().getTime()) return EXPIRED;
    const { choice } = body;
    if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= question.options.length) {
      return { status: 400 as const, body: { ok: false, error: "Выбери один из переводов" } };
    }
    const { roomId, week, round, id, correct, options, spend } = question;
    const damage = await attackWithReserve(db, user.id, {
      target: "boss", roomId, week, requestId: id, maxDamageDeci: 10 * spend,
      weakSpot: { round, correct: choice === correct },
    }, now);
    if (damage === undefined) return EXPIRED;
    return {
      status: 200 as const,
      body: { ok: true, ...await appBoss(this.deps, user), strike: { damage, correct: damage > spend, translation: options[correct] } },
    };
  }
}
