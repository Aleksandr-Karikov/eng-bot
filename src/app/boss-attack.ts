import { randomUUID } from "node:crypto";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { bossEnabled, bossOf } from "../services/boss";
import { attackWithReserve } from "../services/combat";
import { buildBossRounds, type DuelRound } from "../services/duels";
import { getRoom, isMember } from "../services/rooms";
import { appBoss } from "./api";

const DAMAGE = [0, 5, 10, 18];
const ATTACK_TTL_MS = 15 * 60_000;
const EXPIRED = { status: 409 as const, body: { ok: false, error: "Атака завершилась или босс сменился. Начни новую атаку." } };
const BAD_MOVE = { status: 400 as const, body: { ok: false, error: "Выбери доступное действие." } };

type Phase =
  | { kind: "question" | "decision"; index: number }
  | { kind: "finish"; damage: number; translation?: string };

interface Attack {
  id: string;
  revision: number;
  roomId: number;
  week: string;
  round: number;
  expiresAt: number;
  rounds: DuelRound[];
  phase: Phase;
  settlement?: Promise<number | undefined>;
}

export class AppBossAttack {
  // shortcut: атака возобновляется в живом процессе, после рестарта незавершённая попытка исчезает без расхода.
  private readonly attacks = new Map<number, Attack>();

  constructor(private readonly deps: Deps) {}

  async open(user: User) {
    const { db, now, random } = this.deps;
    const roomId = user.currentRoomId;
    if (roomId == null || !(await isMember(db, roomId, user.id))) return EXPIRED;
    const arena = await appBoss(this.deps, user);
    if (!arena.boss || arena.boss.hp <= 0) return EXPIRED;
    const { boss, combat } = arena;
    const time = now().getTime();
    for (const [userId, attack] of this.attacks) {
      if (attack.expiresAt <= time) this.attacks.delete(userId);
    }
    const pending = () => {
      const attack = this.attacks.get(user.id);
      return attack?.roomId === roomId && attack.week === boss.week && attack.round === boss.round && attack.phase.kind !== "finish"
        ? attack : undefined;
    };
    const current = pending();
    if (current) return this.reply(user, current);
    if (combat.balance < combat.attackCost) {
      return { status: 409 as const, body: { ok: false, error: `Для атаки нужно ${combat.attackCost} ⚡. Энергия копится за карточки, если включено накопление.` } };
    }
    const rounds = await buildBossRounds(db, roomId, user.id, random, DAMAGE.length - 1);
    const opened = pending();
    if (opened) return this.reply(user, opened);
    if (rounds.length < DAMAGE.length - 1) {
      return { status: 409 as const, body: { ok: false, error: "Для атаки нужны три уже показанных тебе слова и четыре разных перевода в словаре комнаты." } };
    }
    const attack: Attack = {
      id: randomUUID(), revision: 0, roomId, week: boss.week, round: boss.round,
      expiresAt: time + ATTACK_TTL_MS, rounds, phase: { kind: "question", index: 0 },
    };
    this.attacks.set(user.id, attack);
    return this.reply(user, attack);
  }

  async act(user: User, body: { id?: unknown; revision?: unknown; move?: unknown; choice?: unknown }) {
    const { db, bossEnabled: enabled, now } = this.deps;
    const attack = this.attacks.get(user.id);
    if (!bossEnabled(user, enabled) || !attack || attack.id !== body.id || attack.roomId !== user.currentRoomId
      || attack.expiresAt <= now().getTime() || !(await isMember(db, attack.roomId, user.id))) return EXPIRED;
    const { revision, choice, move } = body;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision > attack.revision) return BAD_MOVE;
    if (attack.phase.kind === "finish") return this.reply(user, attack);

    const room = await getRoom(db, attack.roomId);
    if (!room || this.attacks.get(user.id) !== attack) return EXPIRED;
    const boss = await bossOf(db, room, now());
    if (this.attacks.get(user.id) !== attack) return EXPIRED;
    if (revision !== attack.revision) return this.reply(user, attack);
    if (boss.week !== attack.week || boss.round !== attack.round || boss.hp <= 0) return EXPIRED;

    const phase = attack.phase;
    if (phase.kind === "question" && move === "answer") {
      const round = attack.rounds[phase.index];
      if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= round.options.length) return BAD_MOVE;
      const next = phase.index + 1;
      attack.phase = choice !== round.correct
        ? { kind: "finish", damage: DAMAGE[phase.index] / 2, translation: round.options[round.correct] }
        : next === attack.rounds.length
          ? { kind: "finish", damage: DAMAGE[next] }
          : { kind: "decision", index: phase.index };
    } else if (phase.kind === "decision" && (move === "stop" || move === "risk")) {
      attack.phase = move === "stop"
        ? { kind: "finish", damage: DAMAGE[phase.index + 1] }
        : { kind: "question", index: phase.index + 1 };
    } else return BAD_MOVE;
    attack.revision++;
    attack.expiresAt = now().getTime() + ATTACK_TTL_MS;
    return this.reply(user, attack);
  }

  private async reply(user: User, attack: Attack) {
    const { id, revision, phase } = attack;
    let view;
    if (phase.kind === "question") {
      const { term, options } = attack.rounds[phase.index];
      view = {
        id, revision, kind: phase.kind, number: phase.index + 1, total: attack.rounds.length, term, options,
        nextDamage: DAMAGE[phase.index + 1], missDamage: DAMAGE[phase.index] / 2,
      } as const;
    } else if (phase.kind === "decision") {
      const damage = DAMAGE[phase.index + 1];
      view = { id, revision, kind: phase.kind, damage, nextDamage: DAMAGE[phase.index + 2], missDamage: damage / 2 } as const;
    } else if (phase.kind === "finish") {
      const pending = attack.settlement ??= attackWithReserve(this.deps.db, user.id, {
        target: "boss", roomId: attack.roomId, week: attack.week, round: attack.round, requestId: id, damage: phase.damage,
      }, this.deps.now);
      try {
        const damage = await pending;
        if (damage === undefined) return EXPIRED;
        return {
          status: 200 as const,
          body: { ok: true, attack: { id, revision, kind: "done" as const, damage, translation: phase.translation }, arena: await appBoss(this.deps, user) },
        };
      } catch (err) {
        if (attack.settlement === pending) attack.settlement = undefined;
        throw err;
      }
    }
    return { status: 200 as const, body: { ok: true, attack: view } };
  }
}
