import { Button, Placeholder, Spinner, Text } from "@telegram-apps/telegram-ui";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
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

/**
 * Фигура босса по фазе: живой, а не прогресс-бар с ушами. Эмодзи здесь — не украшение подписи,
 * а сама картинка босса: другого портрета у него нет, и в тёмной теме он читается как надо.
 */
const FACE: Record<Boss["phase"], { emoji: string; title: string; color: string }> = {
  fresh: { emoji: "🐉", title: "Босс спокоен", color: "#7c8cf8" },
  angry: { emoji: "🐲", title: "Босс злится", color: "#f59e0b" },
  furious: { emoji: "🔥", title: "Босс в ярости", color: "#ef4444" },
  dead: { emoji: "💀", title: "Босс повержен", color: "#22c55e" },
};

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
    getBoss()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

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

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
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
  const face = FACE[boss.phase];
  const percent = Math.min(100, Math.round(boss.damage * 100));
  const dead = boss.phase === "dead";
  // Тряска — только когда бьют впервые: постоянное дрожание раздражает уже на второй минуте.
  const [shake, setShake] = useState(0);
  useEffect(() => {
    if (!dead) setShake((n) => n + 1);
  }, [hits.length, dead]);

  const top = useMemo(() => boss.byUser.slice(0, 4), [boss.byUser]);

  return (
    <div className="screen boss-screen">
      <div className="boss-head">
        <Text weight="2">{boss.room}</Text>
        <Text className="hint">
          {boss.daysLeft > 0 ? `${boss.daysLeft} ${plural(boss.daysLeft, "день", "дня", "дней")} до конца недели` : "Последний день"}
        </Text>
      </div>

      <motion.div
        className="boss-stage"
        key={shake}
        initial={dead ? undefined : { x: -6, rotate: -1 }}
        animate={{ x: 0, rotate: 0 }}
        transition={{ type: "spring", stiffness: 320, damping: 12 }}
      >
        <motion.div
          className="boss-face"
          style={{ filter: dead ? "grayscale(1) opacity(0.6)" : undefined }}
          animate={dead ? { scale: [1, 1.15, 1], rotate: [0, -8, 8, 0] } : { y: [0, -6, 0] }}
          transition={dead ? { duration: 0.9 } : { duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        >
          {face.emoji}
        </motion.div>
        <Text weight="2" style={{ color: face.color }}>
          {face.title}
        </Text>
        <div className="boss-bar" aria-label={`Урон ${percent}%`}>
          <motion.div
            className="boss-bar-fill"
            style={{ background: `linear-gradient(90deg, ${face.color}, ${face.color}88)` }}
            initial={{ width: 0 }}
            animate={{ width: `${percent}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
        <Text className="hint">
          {dead ? `Урон: ${boss.done} из ${boss.target}` : `HP: ${boss.hp} из ${boss.target} · ${PACE[boss.pace]}`}
        </Text>
      </motion.div>

      {dead && <Text className="hint">Следующий босс — в воскресенье в 20:00 по Новосибирску. Продолжай учиться: монеты и трофеи ещё засчитываются.</Text>}
      <div className="boss-hits">
        <Text weight="2">Свежие удары</Text>
        {hits.length === 0 && <Text className="hint">Пока тихо. Первый удар — любая карточка в «Учить».</Text>}
        {hits.slice(0, 8).map((hit, i) => (
          <motion.div
            key={`${hit.at}-${i}`}
            className="boss-hit"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <span>
              <b>{hit.name}</b> нанёс {hit.damage} HP урона
            </span>
            <Text className="hint">{hitTime(hit.at)}</Text>
          </motion.div>
        ))}
        {total > hits.length && <Text className="hint">Всего за неделю — {total} ударов.</Text>}
      </div>

      {top.length > 1 && (
        <div className="boss-members">
          <Text weight="2">Кто сколько снял</Text>
          {top.map((u) => (
            <div key={u.name} className="boss-member">
              <span>{u.name}</span>
              <Text className="hint">{u.count}</Text>
            </div>
          ))}
        </div>
      )}

      {coins && (
        <div className="boss-members">
          <div className="boss-member">
            <span>Монеты недели</span>
            <Text className="hint">{coins.coins}</Text>
          </div>
          <Text weight="2" className="upgrade-title">Магазин усилений</Text>
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
        Трофеи · {trophies.total} из {trophies.of}
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
