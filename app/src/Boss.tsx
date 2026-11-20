import { Button, Placeholder, Spinner, Switch, Text } from "@telegram-apps/telegram-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { buyUpgrade, fight, getBoss, type Boss, type BossPurchase, type BossState, type Coins, type CombatTarget, type HunterState, type Trophies } from "./api";
import { IconLock } from "./icons";
import { haptic, notify, useBackButton } from "./telegram";

const PHASE: Record<Boss["phase"], { title: string; art: string }> = {
  fresh: { title: "Спокоен", art: "boss-arena.webp" },
  angry: { title: "Разозлён", art: "boss-arena.webp" },
  furious: { title: "В ярости", art: "boss-furious.webp" },
  dead: { title: "Повержен", art: "boss-defeated.webp" },
};

const hpFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

const PACE: Record<Boss["pace"], string> = {
  ahead: "опережаете график",
  "on-time": "идёте в темпе",
  behind: "отстаёте от графика",
};

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
  const [fighting, setFighting] = useState<CombatTarget | "bank">();
  const busy = Boolean(buying || fighting);
  useBackButton(onExit);

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
        if (active) timer = setTimeout(refresh, 30_000);
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

  const fightAction = async (action: CombatTarget | "bank") => {
    const combat = data?.combat;
    if (busy || !combat || !data.boss) return;
    const damage = action === "boss"
      ? (combat.hit?.spend ?? Math.min(combat.balance, data.boss.hp))
      : combat.mobs.find((mob) => mob.id === action)?.hp ?? 0;
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

  if (error && !data) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!data) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  if (!data.boss) {
    return (
      <Placeholder
        header="Боссу нужна комната"
        description="Босс недели — это цель комнаты. Заведи комнату в боте (/room) и возвращайся: каждая повторённая карточка станет ударом."
      />
    );
  }
  return (
    <BossView boss={data.boss} hits={data.hits} total={data.total} coins={data.coins} trophies={data.trophies}
      victory={data.victory} combat={data.combat} onBuy={buy} buying={buying} busy={busy}
      actions={data.combat && <CombatPanel combat={data.combat} hp={data.boss.hp} busy={busy} fighting={fighting} onAction={(action) => void fightAction(action)} />} />
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
}) {
  const phase = PHASE[boss.phase];
  const portrait = boss.opponent?.id === "sentinel" ? "boss-sentinel.webp" : phase.art;
  const reducedMotion = useReducedMotion();
  // HP текущего босса, а не недельная цель: у второго босса он толще, и полоска должна это показывать.
  const maxHp = boss.bossHp ?? boss.target;
  const percent = maxHp > 0 ? Math.min(100, (boss.hp / maxHp) * 100) : 0;
  // Добитый босс сразу уступает место следующему, поэтому «мёртв» — это не экран, а счёт побед.
  const kills = boss.kills ?? 0;
  /** «20:00 (UTC+03:00)» — по поясу комнаты, а не зашитым «по Новосибирску». */
  const weekEnd = weekEndLabel(boss.timeZone);
  const previous = useRef(boss);
  const [strike, setStrike] = useState<{ damage: number; done: number }>();

  useEffect(() => {
    const last = previous.current;
    previous.current = boss;
    if (last.room === boss.room && last.week === boss.week && last.round === boss.round && boss.hp < last.hp) {
      setStrike({ damage: last.hp - boss.hp, done: boss.done });
    }
  }, [boss]);

  useEffect(() => {
    if (!strike) return;
    const timer = setTimeout(() => setStrike(undefined), 1400);
    return () => clearTimeout(timer);
  }, [strike]);

  const top = boss.byUser.slice(0, 4);
  const rune = combat?.rune;
  const streak = combat?.streak;

  return (
    <div className="screen boss-screen">
      <div className="boss-stage" data-phase={boss.phase} data-opponent={boss.opponent?.id} data-core={combat?.core ?? undefined}>
        <div className="boss-portrait">
          <img src={`${import.meta.env.BASE_URL}${portrait}`} alt="" />
          <div className="boss-caption">
            <span className="boss-kicker">
              {/* Номер босса: добили — на арене следующий, и это видно сразу, а не по изменившемуся имени. */}
              {(boss.round ?? 1) > 1 ? `Босс недели · ${boss.round}-й за неделю` : "Босс недели"}
            </span>
            <h1>{boss.opponent?.name ?? "Дракон библиотеки"}</h1>
          </div>
          <span className="boss-phase">{phase.title}</span>
          <AnimatePresence>
            {strike && (
              <motion.span key={strike.done} className="boss-strike" aria-hidden="true"
                initial={reducedMotion ? false : { opacity: 0, y: 12, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reducedMotion ? undefined : { opacity: 0, y: -12 }}>
                −{hpFormat.format(strike.damage)} HP
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="boss-hud">
          <div className="boss-hp" aria-live="polite">
            <strong>{hpFormat.format(boss.hp)}</strong> / {hpFormat.format(maxHp)} HP
          </div>
          <div className={strike ? "boss-bar struck" : "boss-bar"} role="progressbar" aria-label="Здоровье босса"
            aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={boss.hp}>
            <div className="boss-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="boss-meta">
            <span>Снято {hpFormat.format(boss.done)} HP</span>
            <span>{kills > 0 ? `Добито: ${kills}` : PACE[boss.pace]}</span>
          </div>
        </div>
      </div>

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
          <Text className="hint">Сейчас на арене {boss.round ?? 1}-й босс. Неделя кончается {weekEnd}.</Text>
        </section>
      )}
      {combat?.core && (
        <div className={`boss-mechanic${combat.core === "ready" ? " ready" : ""}`}>
          <b>{combat.core === "closed" ? "Ядро Стража закрыто" : "Ядро Стража открыто"}</b>
          <span>{combat.core === "closed" ? "Откроется на половине здоровья."
            : combat.core === "spent" ? "Ты уже использовал бонус ядра в этом бою."
            : "Твой следующий ручной удар получит +20% урона."}</span>
        </div>
      )}
      {boss.opponent?.id === "dragon" && boss.phase === "furious" && (
        <div className="boss-mechanic ready"><b>Дракон в ярости</b><span>Диктанты в этой комнате дают +20% базового урона.</span></div>
      )}
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
      {actions}
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
                  {rune.extra > 0 ? ` · +${hpFormat.format(rune.extra)} HP` : rune.saved > 0 ? ` · сбережёт ${hpFormat.format(rune.saved)} HP` : ""}
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

      <Text className="hint boss-footnote">Урон начисляется за ответы на карточки. Режим босса можно выключить в настройках.</Text>
    </div>
  );
}

function CombatPanel({ combat, hp, busy, fighting, onAction }: {
  combat: NonNullable<BossState["combat"]>;
  hp: number;
  busy: boolean;
  fighting?: CombatTarget | "bank";
  onAction: (action: CombatTarget | "bank") => void;
}) {
  const hit = combat.hit ?? { spend: Math.min(hp, combat.balance), damage: Math.min(hp, combat.balance) };
  return (
    <div className="boss-members combat-panel">
      <div className="boss-member">
        <Text weight="2">Запас урона</Text>
        <strong className="combat-balance" aria-live="polite">{hpFormat.format(combat.balance)} HP</strong>
      </div>
      <label className="boss-member combat-toggle">
        <span>Копить урон за карточки</span>
        <Switch checked={combat.bank} disabled={busy} onChange={() => onAction("bank")} />
      </label>
      <Text className="hint">
        {combat.bank ? "Выбирай, на кого потратить запас. Он переносится между неделями." : "Новый урон сразу идёт в босса комнаты."}
      </Text>
      {hp > 0 && (
        <Button size="m" stretched loading={fighting === "boss"} disabled={busy || hit.spend <= 0} onClick={() => onAction("boss")}>
          {hit.damage > 0 ? `Ударить босса на ${hpFormat.format(hit.damage)} HP` : "Ударить босса из запаса"}
        </Button>
      )}
      {hit.damage > hit.spend && <Text className="hint">Из запаса спишется {hpFormat.format(hit.spend)} HP.</Text>}
      <details className="combat-mobs">
        <summary>Мобы недели</summary>
        {combat.mobs.map((mob) => (
          <div className="combat-mob" key={mob.id}>
            <div className="boss-member">
              <Text weight="2"><span aria-hidden="true">{mob.icon}</span> {mob.name}</Text>
              <span className="combat-cost">{mob.hp} HP</span>
            </div>
            <Text className="hint">{mob.reward}</Text>
            {mob.defeated ? <Text className="combat-claim">Награда получена</Text> : (
              <Button size="m" mode="bezeled" stretched loading={fighting === mob.id} disabled={busy || combat.balance < mob.hp} onClick={() => onAction(mob.id)}>
                {combat.balance < mob.hp ? `Не хватает ${hpFormat.format(mob.hp - combat.balance)} HP` : "Атаковать"}
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
