import { Button, Placeholder, Spinner, Switch, Text } from "@telegram-apps/telegram-ui";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, buyUpgrade, fight, getBoss, moveBossAttack, startBossAttack, type Boss, type BossAttack, type BossMove, type BossPurchase, type BossState, type Coins, type CombatTarget, type HunterState, type Trophies } from "./api";
import { BossArena } from "./BossArena";
import { hpFormat } from "./format";
import { IconLock } from "./icons";
import { haptic, notify, useBackButton } from "./telegram";
import { bossScreen } from "../../src/app/boss-screen";

type CombatAction = Exclude<CombatTarget, "boss"> | "bank";

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** Время удара по-человечески: сегодня «14:20», раньше — «вт 14:20». */
function hitTime(iso: string): string {
  const at = new Date(iso);
  const today = new Date();
  const sameDay = at.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("ru-RU", sameDay ? { hour: "2-digit", minute: "2-digit" } : { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(at);
}

/** Время конца недели в поясе комнаты: «в воскресенье в 20:00 (UTC+03:00)». */
function weekEndLabel(timeZone?: string): string {
  if (!timeZone) return "в воскресенье в 20:00";
  try {
    const offset = new Intl.DateTimeFormat("ru-RU", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return offset ? `в воскресенье в 20:00 (${offset})` : "в воскресенье в 20:00";
  } catch {
    return "в воскресенье в 20:00";
  }
}

export function BossScreen({ onExit }: { onExit: () => void }) {
  const [data, setData] = useState<BossState>();
  const [error, setError] = useState<string>();
  const [buying, setBuying] = useState<BossPurchase>();
  const [fighting, setFighting] = useState<CombatAction>();
  const [attack, setAttack] = useState<BossAttack>();
  const [answering, setAnswering] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const attackPending = useRef(false);
  const fightPane = useRef<HTMLDivElement>(null);
  const questionGroup = useRef<HTMLDivElement>(null);
  const busy = Boolean(buying || fighting || answering);
  const back = useCallback(() => {
    if (expanded) setExpanded(false);
    else onExit();
  }, [expanded, onExit]);
  useBackButton(back);

  useEffect(() => {
    if (expanded && attack) {
      fightPane.current?.scrollTo(0, 0);
      questionGroup.current?.focus({ preventScroll: true });
    }
  }, [attack, expanded]);

  useEffect(() => {
    if (busy) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        if (document.visibilityState === "visible") {
          const next = await getBoss();
          if (active) {
            setData(next);
            setError(undefined);
          }
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 30_000);
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [busy]);

  /** Покупка подтверждается сервером: монеты с телефона не считаются. В ответ — свежее состояние. */
  const buy = async (kind: BossPurchase) => {
    if (busy) return;
    setBuying(kind);
    try {
      setData(await buyUpgrade(kind));
      haptic.done(true);
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBuying(undefined);
    }
  };

  const fightAction = async (action: CombatAction) => {
    const combat = data?.combat;
    if (busy || !combat || !data.boss) return;
    const damage = combat.mobs.find((mob) => mob.id === action)?.hp ?? 0;
    setFighting(action);
    try {
      const next = await fight(action === "bank"
        ? { bank: !combat.bank }
        : {
          target: action, roomId: combat.roomId, week: combat.week, requestId: crypto.randomUUID(),
          maxDamageDeci: Math.round(damage * 10),
        });
      setData(next);
      haptic.done(!next.notice);
      if (next.notice) notify(next.notice);
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setFighting(undefined);
    }
  };

  const attackAction = async (move?: BossMove) => {
    if (busy || attackPending.current) return;
    attackPending.current = true;
    if (!move) setExpanded(true);
    setAnswering(true);
    try {
      const result = move && attack ? await moveBossAttack(attack, move) : await startBossAttack();
      setAttack(result.attack);
      if (result.arena) setData(result.arena);
      if (result.attack.kind === "done") haptic.done(result.attack.translation === undefined);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setAttack(undefined);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      attackPending.current = false;
      setAnswering(false);
    }
  };

  if (error && !data) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!data) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  // Выключенный режим отличается от «нет комнаты» и проверяется первым: во втором случае нужно завести
  // комнату (/room), а в первом комната ни при чём — выключен сам режим (E9).
  if (bossScreen(data).state === "disabled") {
    return (
      <Placeholder
        header="Режим босса выключен"
        description="Босс недели сейчас не показывается. Включить себе — /settings в боте, общий рубильник — у админа (BOSS_ENABLED). Слова и повторения работают как обычно."
      />
    );
  }
  if (!data.boss) {
    return (
      <Placeholder
        header="Боссу нужна комната"
        description="Заведи комнату в боте через /room, чтобы копить энергию и атаковать босса."
      />
    );
  }
  const playing = attack !== undefined && attack.kind !== "done";
  return (
    <BossView boss={data.boss} hits={data.hits} total={data.total} coins={data.coins} trophies={data.trophies}
      victory={data.victory} combat={data.combat} onBuy={(kind) => void buy(kind)} buying={buying} busy={busy || playing}
      attack={attack} expanded={expanded} onToggleArena={() => setExpanded((value) => !value)}
      actions={data.combat && <CombatPanel combat={data.combat} busy={busy || playing} fighting={fighting}
        onAction={(action) => void fightAction(action)} />}
      fightPanel={data.combat && (
        <div className="arena-fight" ref={fightPane}>
          {!expanded && playing && (
            <Button size="m" className="arena-primary" onClick={() => setExpanded(true)}>Продолжить атаку</Button>
          )}
          {expanded && attack?.kind === "question" && (
            <div ref={questionGroup} tabIndex={-1} role="group" aria-label={`Перевод ${attack.term}`} className="arena-turn">
              <div className="arena-turn-head">
                <Text weight="2" className="arena-term">Что значит «{attack.term}»?</Text>
                <span className="arena-note">Вопрос {attack.number} из {attack.total}</span>
              </div>
              <span className="arena-note">Верно — заряд {hpFormat.format(attack.nextDamage)} HP. Ошибка — удар на {hpFormat.format(attack.missDamage)} HP.</span>
              <div className="arena-options">
                {attack.options.map((option, index) => (
                  <Button key={option} className="arena-option" stretched disabled={busy} onClick={() => void attackAction({ move: "answer", choice: index })}>
                    <span>{option}</span>
                  </Button>
                ))}
              </div>
            </div>
          )}
          {expanded && attack?.kind === "decision" && (
            <div ref={questionGroup} tabIndex={-1} role="group" aria-label="Выбор удара" className="arena-turn">
              <Text weight="2">Верный перевод</Text>
              <div className="arena-options">
                <Button className="arena-primary" stretched disabled={busy} onClick={() => void attackAction({ move: "stop" })}>
                  <span>Ударить · {hpFormat.format(attack.damage)} HP</span>
                </Button>
                <Button className="arena-option" stretched disabled={busy} onClick={() => void attackAction({ move: "risk" })}>
                  <span>Рискнуть · до {hpFormat.format(attack.nextDamage)} HP</span>
                </Button>
              </div>
              <span className="arena-note">Если ошибёшься, удар нанесёт {hpFormat.format(attack.missDamage)} HP.</span>
            </div>
          )}
          {attack?.kind === "done" && (
            <div ref={questionGroup} tabIndex={-1} role="status" className="arena-turn arena-result">
              <Text weight="2">−{data.combat.attackCost} ⚡ · нанесено {hpFormat.format(attack.damage)} урона</Text>
              {attack.translation && <span className="arena-note">Правильный перевод — «{attack.translation}».</span>}
            </div>
          )}
          {!playing && data.boss.hp > 0 && (
            <div className="arena-turn">
              <span className="arena-note">До трёх переводов. После верного ответа можно ударить или продолжить. Ошибка оставит половину набранного урона.</span>
              <div className="arena-start">
                <Button size="m" className="arena-primary" loading={answering} disabled={busy || data.combat.balance < data.combat.attackCost}
                  onClick={() => void attackAction()}>
                  Атаковать · {data.combat.attackCost} ⚡
                </Button>
                <strong className="arena-balance">У тебя {hpFormat.format(data.combat.balance)} ⚡</strong>
              </div>
              {data.combat.balance < data.combat.attackCost && (
                <span className="arena-note">До атаки нужно ещё {hpFormat.format(data.combat.attackCost - data.combat.balance)} ⚡.</span>
              )}
            </div>
          )}
        </div>
      )} />
  );
}

function BossView({
  boss,
  hits,
  total,
  coins,
  trophies,
  victory,
  combat,
  onBuy,
  buying,
  busy,
  actions,
  attack,
  fightPanel,
  expanded,
  onToggleArena,
}: {
  boss: Boss;
  hits: BossState["hits"];
  total: number;
  coins?: Coins;
  trophies?: Trophies;
  victory?: BossState["victory"];
  combat?: BossState["combat"];
  onBuy: (kind: BossPurchase) => void;
  buying: BossPurchase | undefined;
  busy: boolean;
  actions?: React.ReactNode;
  attack?: BossAttack;
  fightPanel?: React.ReactNode;
  expanded: boolean;
  onToggleArena: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const kills = boss.kills ?? 0;
  const weekEnd = weekEndLabel(boss.timeZone);
  const top = boss.byUser.slice(0, 4);
  const rune = combat?.rune;
  const streak = combat?.streak;
  const arena = (
    <BossArena boss={boss} attack={attack} expanded={expanded} onToggle={onToggleArena}>{fightPanel}</BossArena>
  );

  if (expanded) return <div className="boss-fullscreen">{arena}</div>;

  return (
    <div className="screen boss-screen">
      {arena}

      <div className="boss-head">
        <Text weight="2">{boss.room}</Text>
        <Text className="hint">
          {boss.daysLeft > 0 ? `${boss.daysLeft} ${plural(boss.daysLeft, "день", "дня", "дней")} до конца недели` : "Последний день"}
        </Text>
      </div>

      {kills > 0 && (
        <section className="boss-members boss-victory" aria-label="Итоги боя">
          <h2>🏆 {kills === 1 ? "Босс повержен" : `Боссов повержено: ${kills}`}</h2>
          {victory?.finalBlow && <Text>Добил <b>{victory.finalBlow.name}</b> <span className="hint">· {hitTime(victory.finalBlow.at)}</span></Text>}
          {boss.byUser.map((player, i) => (
            <div className="boss-member" key={i}><span>{player.name}</span><b>{hpFormat.format(player.count)} HP</b></div>
          ))}
          {victory?.teamTrophy && <Text className="hint">Трофей «Победа команды» получат все, кто внёс урон, при подведении итогов недели.</Text>}
          {/* Арена не пустует: следующий стоит уже сейчас, а не в воскресенье. */}
          <Text className="hint">Добито за неделю: {kills}. Неделя кончается {weekEnd} — в понедельник те же боссы, но ты сильнее.</Text>
        </section>
      )}
      {boss.opponent?.id === "dragon" && boss.phase === "furious" && (
        <div className="boss-mechanic ready"><b>Дракон в ярости</b><span>Диктанты в этой комнате дают +20% базового урона.</span></div>
      )}
      {actions}
      {streak && (
        <section className="boss-members streak-buff" aria-label="Ударный режим">
          <div className="boss-member">
            <Text weight="2">🔥 Ударный режим</Text>
            {streak.percent > 0 && <b className="combat-claim">+{streak.percent}% урона</b>}
          </div>
          <Text className="hint">
            {streak.days > 0
              ? `${streak.days}${streak.next ? "" : "+"} ${plural(streak.days, "день", "дня", "дней")} подряд`
              : "Ответь на карточку, чтобы начать серию."}
            {streak.days > 0 && streak.next && ` · следующий баф на ${streak.next.days}-й день`}
          </Text>
          <div className="streak-tiers">
            {streak.tiers.map((tier) => (
              <div key={tier.days} aria-current={tier.percent === streak.percent ? "true" : undefined}>
                <span>{tier.days} {plural(tier.days, "день", "дня", "дней")}</span>
                <b>+{tier.percent}%</b>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="boss-hits">
        <Text weight="2">⚔️ Свежие удары</Text>
        {hits.length === 0 && <Text className="hint">Босс пока не получил урона.</Text>}
        {hits.slice(0, 8).map((hit, i) => (
          <motion.div
            key={`${hit.at}-${i}`}
            className="boss-hit"
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <span>
              <b>{hit.name}</b>
              <span className="boss-hit-time">{hitTime(hit.at)}</span>
            </span>
            <span className="boss-hit-damage">−{hpFormat.format(hit.damage)} HP</span>
          </motion.div>
        ))}
        {total > hits.length && <Text className="hint">Удары и ответы за неделю: {total}.</Text>}
      </div>

      {top.length > 1 && (
        <div className="boss-members">
          <Text weight="2">Вклад команды</Text>
          {top.map((u, i) => (
            <div key={i} className="boss-member">
              <span>{u.name}</span>
              <Text className="hint">{hpFormat.format(u.count)} HP</Text>
            </div>
          ))}
        </div>
      )}

      {coins && (
        <div className="boss-members">
          <div className="boss-member">
            <span>🪙 Монеты недели</span>
            <Text className="hint">{coins.coins}</Text>
          </div>
          <Text weight="2" className="upgrade-title">🛍 Магазин усилений</Text>
          {rune && (
            <div className="upgrade-offer">
              <Text weight="2">◇ Руна пробоя</Text>
              <Text className="hint">+25% к следующему ручному удару по боссу, до +10 HP.</Text>
              {rune.owned ? <Text className="combat-claim">Руна в запасе</Text> : (
                <Button size="m" mode="bezeled" stretched loading={buying === "rune"} disabled={busy || coins.coins < rune.price} onClick={() => onBuy("rune")}>
                {coins.coins < rune.price ? `Нужно ${rune.price} монет` : `Купить за ${rune.price} монет`}
                </Button>
              )}
            </div>
          )}
          {coins.offers.map((offer) => (
            <div className="upgrade-offer" key={offer.kind}>
              <div className="boss-member">
                <Text weight="2" className="upgrade-title">{offer.title}</Text>
                <Text className="hint">Ур. {offer.level} · +{offer.level * offer.bonus}%</Text>
              </div>
              <Text className="hint">{offer.description}</Text>
              {offer.price === null ? <Text className="hint">Максимальный уровень</Text> : (
                <Button mode="bezeled" size="m" stretched loading={buying === offer.kind} disabled={busy || coins.coins < offer.price} onClick={() => onBuy(offer.kind)}>
                  {coins.coins < offer.price
                    ? `Не хватает ${Math.round((offer.price - coins.coins) * 10) / 10} (цена ${offer.price})`
                    : `Улучшить за ${offer.price} ${plural(offer.price, "монету", "монеты", "монет")}`}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {coins && <Text className="hint">Монеты общие для комнат и сгорают в воскресенье в 20:00 по поясу кошелька. Усиления остаются навсегда и действуют на новые ответы. Бонусы «Силы» и навыка складываются от базового урона.</Text>}
      {trophies && trophies.all.length > 0 && <TrophyShelf trophies={trophies} />}

      <Text className="hint boss-footnote">Карточки дают энергию, если включено накопление. Режим босса можно выключить в настройках.</Text>
    </div>
  );
}

function CombatPanel({ combat, busy, fighting, onAction }: {
  combat: NonNullable<BossState["combat"]>;
  busy: boolean;
  fighting?: CombatAction;
  onAction: (action: CombatAction) => void;
}) {
  return (
    <div className="boss-members combat-panel">
      <div className="boss-member">
        <Text weight="2">Энергия</Text>
        <strong className="combat-balance" aria-live="polite">{hpFormat.format(combat.balance)} ⚡</strong>
      </div>
      <label className="boss-member combat-toggle">
        <span>Копить энергию за карточки</span>
        <Switch aria-label="Копить энергию за карточки" checked={combat.bank} disabled={busy} onChange={() => onAction("bank")} />
      </label>
      <Text className="hint">
        {combat.bank ? "Потрать энергию на босса или мобов. Остаток переносится между неделями." : "Ответы сразу наносят урон боссу комнаты."}
      </Text>
      <details className="combat-mobs">
        <summary>Мобы недели</summary>
        {combat.mobs.map((mob) => (
          <div className="combat-mob" key={mob.id}>
            <div className="boss-member">
              <Text weight="2"><span aria-hidden="true">{mob.icon}</span> {mob.name}</Text>
              <span className="combat-cost">{mob.hp} ⚡</span>
            </div>
            <Text className="hint">{mob.reward}</Text>
            {mob.defeated ? <Text className="combat-claim">Награда получена</Text> : (
              <Button size="m" mode="bezeled" stretched loading={fighting === mob.id} disabled={busy || combat.balance < mob.hp} onClick={() => onAction(mob.id)}>
                {combat.balance < mob.hp ? `Не хватает ${hpFormat.format(mob.hp - combat.balance)} ⚡` : "Атаковать"}
              </Button>
            )}
          </div>
        ))}
      </details>
      {combat.hunt && <HunterRelics hunt={combat.hunt} />}
    </div>
  );
}

function HunterRelics({ hunt }: { hunt: HunterState }) {
  const next = hunt.relics.find((relic) => relic.weeks > hunt.weeks);
  const bonusFor = { all: "ко всему урону за ответы", listen: "к урону диктантов", writing: "к урону за пропуски и свои предложения" };
  return (
    <section className="hunter-relics" aria-label="Реликвии охотника">
      <Text weight="2">Реликвии охотника</Text>
      {next ? (
        <>
          <Text>До «{next.name}» {hunt.weeks} из {next.weeks} недель</Text>
          <progress className="hunter-progress" value={hunt.weeks} max={next.weeks} aria-label={`Прогресс до реликвии «${next.name}»`} />
        </>
      ) : <Text>Все реликвии открыты</Text>}
      {next && <Text className="hint">{hunt.thisWeek ? "Эта неделя уже засчитана." : "Победи любого моба, чтобы засчитать эту неделю."}</Text>}
      <details>
        <summary>Постоянные бонусы</summary>
        {hunt.relics.map((relic) => (
          <div className="hunter-reward" key={relic.weeks}>
            <div className="boss-member">
              <Text weight="2"><span aria-hidden="true">{relic.icon}</span> {relic.name}</Text>
              <span className="combat-cost">{hunt.weeks >= relic.weeks ? "Открыта" : `${relic.weeks} ${plural(relic.weeks, "неделя", "недели", "недель")}`}</span>
            </div>
            <Text className="hint">+{relic.percent}% {bonusFor[relic.skill]}</Text>
          </div>
        ))}
      </details>
    </section>
  );
}

/**
 * Полка трофеев: полученные цветные, остальные серым с подсказкой «как». Коллекция без «как получить»
 * — просто картинки; с условием — цель, к которой идут.
 */
function TrophyShelf({ trophies }: { trophies: Trophies }) {
  const byKind = new Map(trophies.earned.map((e) => [e.kind, e]));
  const earned = trophies.all.filter((t) => byKind.has(t.kind));
  const rest = trophies.all.filter((t) => !byKind.has(t.kind));
  return (
    <div className="boss-members">
      <Text weight="2">
        🏆 Трофеи · {trophies.total} из {trophies.of}
      </Text>
      {earned.length === 0 && <Text className="hint">Пока пусто. Первый появится в воскресенье — за эту неделю.</Text>}
      <div className="trophy-grid">
        {earned.map((t) => {
          const e = byKind.get(t.kind)!;
          return (
            <details className="trophy-detail" key={t.kind}><summary className="trophy">
              <span className="trophy-emoji">{t.emoji}</span>
              <span>{t.title}</span>
              {e.count > 1 && <Text className="hint">×{e.count}</Text>}
            </summary><Text className="hint">{t.how}</Text></details>
          );
        })}
        {rest.map((t) => (
          <details className="trophy-detail locked" key={t.kind}><summary className="trophy">
            <span className="trophy-emoji"><IconLock size={16} /></span>
            <span>{t.title}</span>
          </summary><Text className="hint">{t.how}</Text></details>
        ))}
      </div>
    </div>
  );
}
