import { randomUUID } from "node:crypto";
import { bossAttackDamage, BOSS_ATTACK_ROUNDS, MIN_BOSS_ATTACK_STAKE } from "../boss-attack-rules";
import { BOSS_OPPONENTS, type BossId } from "../boss-opponents";
import type { Deps } from "../bot/context";
import type { User } from "../db/schema";
import { bossEnabled, bossOf } from "../services/boss";
import { attackWithReserve } from "../services/combat";
import { buildBossRounds, type DuelRound } from "../services/duels";
import { getRoom, isMember } from "../services/rooms";
import { appBoss } from "./api";
import { playDuelTurn, startDuel, type BossDuelTurn, type DuelScene } from "./boss-duel";

const ATTACK_TTL_MS = 15 * 60_000;
const EXPIRED = { status: 409 as const, body: { ok: false, error: "Атака завершилась или босс сменился. Начни новую атаку." } };
const BAD_MOVE = { status: 400 as const, body: { ok: false, error: "Выбери доступное действие." } };

type Phase =
  | { kind: "question" | "decision"; index: number }
  | BossDuelTurn
  | { kind: "finish"; damage: number; translation?: string; scene?: string; duel?: DuelScene };

interface Attack {
  id: string;
  revision: number;
  roomId: number;
  target?: { week: string; round: number };
  stake: number;
  expiresAt: number;
  rounds: DuelRound[];
  phase: Phase;
  settlement?: Promise<number | undefined>;
}

export class AppBossAttack {
  // shortcut: атака возобновляется в живом процессе, после рестарта незавершённая попытка исчезает без расхода.
  private readonly attacks = new Map<number, Attack>();
  private readonly practices = new Map<number, Attack>();

  constructor(private readonly deps: Deps) {}

  async open(user: User, body: { stake?: unknown; mode?: unknown; opponent?: unknown }) {
    const { mode } = body;
    if (mode !== undefined && mode !== "duel" && mode !== "dragon" && mode !== "practice") return BAD_MOVE;
    if (body.opponent !== undefined && (typeof body.opponent !== "string" || !Object.hasOwn(BOSS_OPPONENTS, body.opponent))) return BAD_MOVE;
    const practice = mode === "practice";
    const attempts = practice ? this.practices : this.attacks;
    const stake = body.stake === undefined ? MIN_BOSS_ATTACK_STAKE : body.stake;
    if (typeof stake !== "number" || !Number.isSafeInteger(stake) || stake < MIN_BOSS_ATTACK_STAKE
      || (practice && stake !== MIN_BOSS_ATTACK_STAKE)) {
      return { status: 400 as const, body: { ok: false, error: `Ставка должна быть целым числом от ${MIN_BOSS_ATTACK_STAKE} ⚡.` } };
    }
    const { db, now, random } = this.deps;
    const roomId = user.currentRoomId;
    if (roomId == null || !bossEnabled(user, this.deps.bossEnabled) || !(await isMember(db, roomId, user.id))) return EXPIRED;
    const arena = practice ? undefined : await appBoss(this.deps, user);
    const boss = arena?.boss;
    if (!practice && (!boss || boss.hp <= 0)) return EXPIRED;
    const opponent = practice ? (body.opponent as BossId | undefined) ?? "dragon" : boss?.opponent.id ?? "dragon";
    if ((mode === "dragon" && opponent !== "dragon") || (!practice && body.opponent !== undefined && body.opponent !== opponent)) return EXPIRED;
    const time = now().getTime();
    for (const [userId, attack] of attempts) {
      if (attack.expiresAt <= time) attempts.delete(userId);
    }
    const pending = () => {
      const attack = attempts.get(user.id);
      return attack?.roomId === roomId && attack.target?.week === boss?.week && attack.target?.round === boss?.round && attack.phase.kind !== "finish"
        && (!practice || (attack.phase.kind === "dragon" && attack.phase.duel.opponent === opponent))
        ? attack : undefined;
    };
    const current = pending();
    if (current) return this.reply(user, current);
    const combat = arena?.boss && arena.combat;
    if (combat && combat.balance < combat.attackCost) {
      return { status: 409 as const, body: { ok: false, error: `Для атаки нужно ${combat.attackCost} ⚡. Энергия копится за карточки, если включено накопление.` } };
    }
    if (combat && stake > combat.maxAttackStake) {
      return { status: 409 as const, body: { ok: false, error: `Сейчас можно поставить до ${combat.maxAttackStake} ⚡.` } };
    }
    const rounds = mode === undefined ? await buildBossRounds(db, roomId, user.id, random, BOSS_ATTACK_ROUNDS) : [];
    const opened = pending();
    if (opened) return this.reply(user, opened);
    if (mode === undefined && rounds.length < BOSS_ATTACK_ROUNDS) {
      return { status: 409 as const, body: { ok: false, error: "Для атаки нужны три уже показанных тебе слова и четыре разных перевода в словаре комнаты." } };
    }
    const previous = attempts.get(user.id);
    const supportsBothScenes = mode === "duel" || (practice && body.opponent !== undefined);
    const lastScene = supportsBothScenes && previous?.roomId === roomId && previous.phase.kind === "finish" ? previous.phase.duel : undefined;
    const attack: Attack = {
      id: randomUUID(), revision: 0, roomId, target: boss && { week: boss.week, round: boss.round }, stake,
      expiresAt: time + ATTACK_TTL_MS, rounds,
      phase: mode === undefined ? { kind: "question", index: 0 } : startDuel(opponent, stake, random, lastScene, supportsBothScenes),
    };
    attempts.set(user.id, attack);
    return this.reply(user, attack);
  }

  async act(user: User, body: { id?: unknown; revision?: unknown; move?: unknown; choice?: unknown; action?: unknown; order?: unknown }) {
    const { db, bossEnabled: enabled, now, random } = this.deps;
    const practice = this.practices.get(user.id);
    const attempts = practice && practice.id === body.id ? this.practices : this.attacks;
    const attack = attempts.get(user.id);
    if (!bossEnabled(user, enabled) || !attack || attack.id !== body.id || attack.roomId !== user.currentRoomId
      || attack.expiresAt <= now().getTime() || !(await isMember(db, attack.roomId, user.id))) return EXPIRED;
    const { revision, choice, move } = body;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0 || revision > attack.revision) return BAD_MOVE;
    if (attack.phase.kind === "finish") return this.reply(user, attack);

    const room = attack.target && await getRoom(db, attack.roomId);
    const boss = room && await bossOf(db, room, now());
    if (attempts.get(user.id) !== attack) return EXPIRED;
    if (revision !== attack.revision) return this.reply(user, attack);
    if (attack.target && (!boss || boss.week !== attack.target.week || boss.round !== attack.target.round || boss.hp <= 0)) return EXPIRED;

    const phase = attack.phase;
    if (phase.kind === "question" && move === "answer") {
      const round = attack.rounds[phase.index];
      if (typeof choice !== "number" || !Number.isInteger(choice) || choice < 0 || choice >= round.options.length) return BAD_MOVE;
      const next = phase.index + 1;
      attack.phase = choice !== round.correct
        ? { kind: "finish", damage: bossAttackDamage(attack.stake, phase.index, true), translation: round.options[round.correct] }
        : next === attack.rounds.length
          ? { kind: "finish", damage: bossAttackDamage(attack.stake, next) }
          : { kind: "decision", index: phase.index };
    } else if (phase.kind === "decision" && (move === "stop" || move === "risk")) {
      attack.phase = move === "stop"
        ? { kind: "finish", damage: bossAttackDamage(attack.stake, phase.index + 1) }
        : { kind: "question", index: phase.index + 1 };
    } else if (phase.kind === "dragon" && move === "phrase") {
      const next = playDuelTurn(phase, body.action, body.order, attack.stake, random);
      if (!next) return BAD_MOVE;
      attack.phase = next;
    } else return BAD_MOVE;
    attack.revision++;
    attack.expiresAt = now().getTime() + ATTACK_TTL_MS;
    return this.reply(user, attack);
  }

  private async reply(user: User, attack: Attack) {
    const { id, revision, phase, stake, target } = attack;
    let view;
    if (phase.kind === "question") {
      const { term, options } = attack.rounds[phase.index];
      view = {
        id, revision, stake, kind: phase.kind, number: phase.index + 1, total: attack.rounds.length, term, options,
        damage: bossAttackDamage(stake, phase.index), nextDamage: bossAttackDamage(stake, phase.index + 1),
        missDamage: bossAttackDamage(stake, phase.index, true),
      } as const;
    } else if (phase.kind === "decision") {
      const damage = bossAttackDamage(stake, phase.index + 1);
      view = {
        id, revision, stake, kind: phase.kind, damage, nextDamage: bossAttackDamage(stake, phase.index + 2),
        missDamage: bossAttackDamage(stake, phase.index + 1, true),
      } as const;
    } else if (phase.kind === "dragon") {
      view = { ...phase, id, revision, stake, practice: !target };
    } else if (phase.kind === "finish") {
      const done = { id, revision, stake, kind: "done" as const, damage: phase.damage, translation: phase.translation, scene: phase.scene, duel: phase.duel };
      if (!target) return { status: 200 as const, body: { ok: true, attack: { ...done, practice: true } } };
      const pending = attack.settlement ??= attackWithReserve(this.deps.db, user.id, {
        target: "boss", roomId: attack.roomId, ...target, requestId: id, stake, damage: phase.damage,
      }, this.deps.now);
      try {
        const damage = await pending;
        if (damage === undefined) return EXPIRED;
        return {
          status: 200 as const,
          body: { ok: true, attack: { ...done, damage }, arena: await appBoss(this.deps, user) },
        };
      } catch (err) {
        if (attack.settlement === pending) attack.settlement = undefined;
        throw err;
      }
    }
    return { status: 200 as const, body: { ok: true, attack: view } };
  }
}
