import { useEffect, useRef, useState, type ReactNode } from "react";
import { arenaImpact, type ArenaImpact } from "../../src/app/boss-screen";
import { BOSS_OPPONENTS, type BossId } from "../../src/boss-opponents";
import type { Boss, BossAttack } from "./api";
import { hpFormat } from "./format";

const PHASE: Record<Boss["phase"], string> = {
  fresh: "Спокоен",
  angry: "Разозлён",
  furious: "В ярости",
  dead: "Повержен",
};

const PACE: Record<Boss["pace"], string> = {
  ahead: "опережаете график",
  "on-time": "идёте в темпе",
  behind: "отстаёте от графика",
};

const art = (name: string) => `${import.meta.env.BASE_URL}arena/${name}.webp`;

export function BossArena({ boss, attack, expanded, onToggle, children }: {
  boss: Boss; attack?: BossAttack; expanded: boolean; onToggle: () => void; children?: ReactNode;
}) {
  const previous = useRef({ boss, attack });
  const sequence = useRef(0);
  const [cue, setCue] = useState<{ impact: ArenaImpact; sequence: number; frame: string }>();
  const frame = `${boss.room}:${boss.week}:${boss.round}:${attack?.id}:${attack?.revision}`;

  useEffect(() => {
    const last = previous.current;
    previous.current = { boss, attack };
    const settled = attack?.kind === "done" && !attack.practice && (last.attack?.id !== attack.id || last.attack.kind !== "done");
    const impact = arenaImpact(last.boss, boss, settled ? attack.damage : undefined);
    if (impact) setCue({ impact, sequence: ++sequence.current, frame });
  }, [boss, attack, frame]);

  useEffect(() => {
    if (!cue) return;
    const timer = setTimeout(() => setCue(undefined), 1100);
    return () => clearTimeout(timer);
  }, [cue]);

  const practice = expanded && attack?.practice;
  const liveOpponent: BossId = boss.opponent?.id ?? "dragon";
  const duel = expanded && (attack?.kind === "dragon" || (attack?.kind === "done" && (practice || liveOpponent === attack.duel?.opponent)))
    ? attack.duel : undefined;
  const opponent = duel?.opponent ?? liveOpponent;
  const playing = attack !== undefined && attack.kind !== "done";
  const charge = attack?.kind === "question" || attack?.kind === "decision" ? attack.damage : 0;
  const impact = !practice && cue?.frame === frame ? cue.impact : undefined;
  const maxHp = boss.bossHp ?? boss.target;
  const percent = maxHp > 0 ? Math.min(100, (boss.hp / maxHp) * 100) : 0;
  const kills = boss.kills ?? 0;
  const pose = impact?.kind ?? (attack?.kind === "decision" ? "charge" : charge > 0 ? "risk" : "idle");
  const effectKey = impact ? `impact:${cue?.sequence}` : `turn:${attack?.id}:${attack?.revision}`;

  return (
    <section className="boss-stage" data-phase={practice ? "fresh" : boss.phase} data-opponent={opponent}
      data-playing={playing} data-duel={duel?.opening} data-enemy-pose={duel?.frame.boss}>
      <div className="boss-portrait">
        <img className="arena-backdrop" src={art(`${opponent}-hall`)} alt="" />
        <div className="arena-floor-light" aria-hidden="true" />
        <div className="arena-effects" data-pose={pose} key={duel && !impact ? `duel:${attack?.id}` : effectKey} aria-hidden="true">
          {impact?.kind === "victory" && <img className="arena-defeated" src={art(impact.defeated)} alt="" />}
          <div className="arena-character">
            <img className="arena-actor" src={art(opponent)} alt="" />
          </div>
          <div className="arena-shield" />
          {charge > 0 && <div className="arena-charge-light" />}
          {impact?.kind === "hit" && impact.own && <div className="arena-projectile" />}
          {impact?.kind === "hit" && <div className="arena-impact-light" />}
        </div>
        {duel && (
          <div className="duel-props" data-settled={attack?.kind === "done"} data-threat={duel.frame.threat} aria-hidden="true">
            {duel.frame.threat && <div className="duel-threat" data-target={duel.frame.threat} />}
            <div className="duel-hero" data-position={duel.frame.hero}>
              <img src={art("duel-hero")} alt="" />
            </div>
            {opponent === "dragon" && <>
              <img className="dragon-pillar" src={art("duel-pillar")} alt="" />
              <img className="dragon-ballista" src={art("duel-ballista")} alt="" />
            </>}
            {opponent === "sentinel" && <>
              <div className="sentinel-seal" data-side="left" />
              <div className="sentinel-seal" data-side="right" />
              <img className="sentinel-mirror" data-turned={duel.frame.effect === "beam" && duel.frame.boss === "fallen"} src={art("duel-mirror")} alt="" />
            </>}
            {opponent === "frost" && <>
              <img className="frost-crystal" data-side="left" src={art(duel.opening === "bridge" ? "duel-ice-rock" : "duel-crystal")} alt="" />
              <img className="frost-crystal" data-side="right" src={art("duel-crystal")} alt="" />
            </>}
            {attack?.kind === "dragon" && duel.frame.effect && <div key={effectKey} className="duel-effect" data-effect={duel.frame.effect} />}
            {attack?.kind === "done" && attack.damage > 0 && <div className="duel-effect" data-effect="slash" />}
          </div>
        )}
        <div className="boss-caption">
          <span className="boss-kicker">
            {practice ? "Тренировка" : boss.tier && boss.tier > 1
              ? `Босс недели · ступень ${boss.tier}${boss.cycle && boss.cycle > 1 ? ` · круг ${boss.cycle}` : ""}`
              : "Босс недели"}
          </span>
          <h1>{BOSS_OPPONENTS[opponent].name}</h1>
        </div>
        <button type="button" className="arena-view-toggle" onClick={onToggle}>{expanded ? "К боссу" : "На весь экран"}</button>
        {!duel && <span className="boss-phase">{PHASE[boss.phase]}</span>}
        {impact && <span key={cue?.sequence} className="boss-strike" aria-hidden="true">
          {impact.kind === "hit" ? `−${hpFormat.format(impact.damage)} HP` : impact.kind === "block" ? "Удар отражён" : "Новый раунд"}
        </span>}
      </div>
      {practice ? <div className="boss-hud arena-note">Энергия не тратится. Урон остаётся в тренировке.</div> : <div className="boss-hud">
        <div className="arena-hud-line">
          <div className="boss-hp" aria-live="polite">
            <strong>{hpFormat.format(boss.hp)}</strong> / {hpFormat.format(maxHp)} HP
          </div>
          {playing && <div className="arena-power">
            <span>Ставка · {hpFormat.format(attack.stake)} ⚡</span>
            {charge > 0 && <span className="arena-charge" aria-live="polite">Заряд · {hpFormat.format(charge)} HP</span>}
          </div>}
        </div>
        <div className={impact?.kind === "hit" ? "boss-bar struck" : "boss-bar"} role="progressbar" aria-label="Здоровье босса"
          aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={boss.hp}>
          <div className="boss-bar-fill" style={{ width: `${percent}%` }} />
        </div>
        {!playing && <div className="boss-meta">
          <span>Снято {hpFormat.format(boss.done)} HP</span>
          <span>{kills > 0 ? `Добито: ${kills}` : PACE[boss.pace]}</span>
        </div>}
      </div>}
      {children}
    </section>
  );
}
