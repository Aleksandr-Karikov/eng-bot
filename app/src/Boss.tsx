import { Button, Placeholder, Spinner, Text } from "@telegram-apps/telegram-ui";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { buyUpgrade, getBoss, type Boss, type BossState, type Coins, type Trophies, type UpgradeKind } from "./api";
import { IconLock } from "./icons";
import { haptic, notify, useBackButton } from "./telegram";

/**
 * Вкладка босса — картина боя, а не ещё одна кнопка «учиться».
 *
 * Два правила этой вкладки:
 * 1. Тапать не надо ничего. Урон приходит из обычных карточек в /learn: босс смотрит на тренировку,
 *    а не требует отдельной сессии. Иначе это была бы добавка к учёбе, а не её альтернатива.
 * 2. HP — это цель комнаты (services/boss.ts), ни очков, ни валюты. Полоска здесь и в /goal — одна.
 */

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

export function BossScreen({ onExit }: { onExit: () => void }) {
  const [data, setData] = useState<BossState>();
  const [error, setError] = useState<string>();
  const [buying, setBuying] = useState<UpgradeKind>();
  useBackButton(onExit);

  useEffect(() => {
    if (buying) return;
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
  }, [buying]);

  /** Покупка подтверждается сервером: монеты с телефона не считаются. В ответ — свежее состояние. */
  const buy = async (kind: UpgradeKind) => {
    if (buying) return;
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
    <BossView boss={data.boss} hits={data.hits} total={data.total} coins={data.coins} trophies={data.trophies} onBuy={buy} buying={buying} />
  );
}

function BossView({
  boss,
  hits,
  total,
  coins,
  trophies,
  onBuy,
  buying,
}: {
  boss: Boss;
  hits: BossState["hits"];
  total: number;
  coins?: Coins;
  trophies?: Trophies;
  onBuy: (kind: UpgradeKind) => void;
  buying: UpgradeKind | undefined;
}) {
  const phase = PHASE[boss.phase];
  const reducedMotion = useReducedMotion();
  const percent = boss.target > 0 ? Math.min(100, (boss.hp / boss.target) * 100) : 0;
  const dead = boss.phase === "dead";
  const previous = useRef(boss);
  const [strike, setStrike] = useState<{ damage: number; done: number }>();

  useEffect(() => {
    const last = previous.current;
    previous.current = boss;
    if (last.room === boss.room && last.target === boss.target && boss.hp < last.hp) {
      setStrike({ damage: last.hp - boss.hp, done: boss.done });
    }
  }, [boss]);

  useEffect(() => {
    if (!strike) return;
    const timer = setTimeout(() => setStrike(undefined), 1400);
    return () => clearTimeout(timer);
  }, [strike]);

  const top = boss.byUser.slice(0, 4);

  return (
    <div className="screen boss-screen">
      <div className="boss-stage" data-phase={boss.phase}>
        <div className="boss-portrait">
          <img src={`${import.meta.env.BASE_URL}${phase.art}`} alt="" />
          <div className="boss-caption">
            <span className="boss-kicker">Босс недели</span>
            <h1>Дракон библиотеки</h1>
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
            <strong>{hpFormat.format(boss.hp)}</strong> / {hpFormat.format(boss.target)} HP
          </div>
          <div className={strike ? "boss-bar struck" : "boss-bar"} role="progressbar" aria-label="Здоровье босса"
            aria-valuemin={0} aria-valuemax={boss.target} aria-valuenow={boss.hp}>
            <div className="boss-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="boss-meta">
            <span>Снято {hpFormat.format(boss.done)} HP</span>
            <span>{dead ? "Победа команды" : PACE[boss.pace]}</span>
          </div>
        </div>
      </div>

      <div className="boss-head">
        <Text weight="2">{boss.room}</Text>
        <Text className="hint">
          {boss.daysLeft > 0 ? `${boss.daysLeft} ${plural(boss.daysLeft, "день", "дня", "дней")} до конца недели` : "Последний день"}
        </Text>
      </div>

      {dead && <Text className="hint">Следующий босс — в воскресенье в 20:00 по Новосибирску. Продолжай учиться: монеты и трофеи ещё засчитываются.</Text>}
      <div className="boss-hits">
        <Text weight="2">⚔️ Свежие удары</Text>
        {hits.length === 0 && <Text className="hint">Пока тихо. Первый удар — любая карточка в «Учить».</Text>}
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
        {total > hits.length && <Text className="hint">За неделю: {total} {plural(total, "ответ", "ответа", "ответов")}.</Text>}
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
          {coins.offers.map((offer) => (
            <div className="upgrade-offer" key={offer.kind}>
              <div className="boss-member">
                <Text weight="2" className="upgrade-title">{offer.title}</Text>
                <Text className="hint">Ур. {offer.level} · +{offer.level * offer.bonus}%</Text>
              </div>
              <Text className="hint">{offer.description}</Text>
              {offer.price === null ? <Text className="hint">Максимальный уровень</Text> : (
                <Button mode="bezeled" size="m" stretched loading={buying === offer.kind} disabled={Boolean(buying) || coins.coins < offer.price} onClick={() => onBuy(offer.kind)}>
                  {coins.coins < offer.price
                    ? `Не хватает ${Math.round((offer.price - coins.coins) * 10) / 10} (цена ${offer.price})`
                    : `Улучшить за ${offer.price} ${plural(offer.price, "монету", "монеты", "монет")}`}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {coins && <Text className="hint">Монеты общие для комнат и сгорают в воскресенье в 20:00 по Новосибирску. Усиления остаются навсегда и действуют на новые ответы. Бонусы «Силы» и навыка складываются от базового урона.</Text>}
      {trophies && trophies.all.length > 0 && <TrophyShelf trophies={trophies} />}

      <Text className="hint boss-footnote">Босс считает удары сам — из ответов на карточки. Выключить можно в настройках.</Text>
    </div>
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
