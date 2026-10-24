import { Button, Placeholder, Spinner, Text, Title } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { getTriage, mediaUrl, sendTriage, type TriageAction, type TriageCard } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { transcription, USEFULNESS } from "./format";
import { haptic, notify, useBackButton } from "./telegram";

/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;
const UNDO_DEPTH = 5;

/**
 * 🆕 Новые слова от друзей: про каждое — одним свайпом. Вправо — уже знаю, влево — учу (как «помню / забыл»
 * в карточках), вверх — не для меня. Решения уходят в фоне, последние можно отменить ↩️.
 */
export function Triage({ onExit }: { onExit: () => void }) {
  const [deck, setDeck] = useState<TriageCard[]>();
  const [error, setError] = useState<string>();
  const [history, setHistory] = useState<Array<{ card: TriageCard; action: TriageAction; sent: Promise<unknown> }>>([]);
  useBackButton(onExit);

  useEffect(() => {
    getTriage()
      .then(setDeck)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const decide = useCallback((card: TriageCard, action: TriageAction) => {
    haptic.tap(action === "learn" ? "medium" : "light");
    const sent = sendTriage(card, action).catch(() => {});
    setHistory((h) => [...h, { card, action, sent }].slice(-UNDO_DEPTH));
    setDeck((d) => d?.slice(1));
  }, []);

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    try {
      await last.sent;
      await sendTriage(last.card, last.action, true);
      setDeck((d) => [last.card, ...(d ?? [])]);
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [history]);

  const card = deck?.[0];
  const header = (
    <header className="top">
      <Text weight="2">🆕 Новые от друзей</Text>
      <div className="top-right">
        {deck && card && <Text className="hint">{deck.length}</Text>}
        {history.length > 0 && (
          <button className="corner-button" aria-label="Отменить последнее решение" onClick={() => void undo()}>
            ↩️
          </button>
        )}
      </div>
    </header>
  );

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!deck) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  return (
    <div className="screen">
      {header}
      {card ? <Swipe key={card.cardId} card={card} onDecide={(a) => decide(card, a)} /> : <AllDone onExit={onExit} />}
    </div>
  );
}

function AllDone({ onExit }: { onExit: () => void }) {
  const native = useBottomButtons({ text: "К карточкам", onClick: onExit });
  return (
    <Placeholder
      header="Все новые слова разобраны 👌"
      description="Те, что учишь, придут в карточках."
      action={native ? undefined : <Button onClick={onExit}>К карточкам</Button>}
    />
  );
}

async function play(card: TriageCard, accent: "uk" | "us") {
  const url = await mediaUrl(`/api/audio?word=${card.word.id}&accent=${accent}`);
  if (url) void new Audio(url).play().catch(() => {});
}

function Swipe({ card, onDecide }: { card: TriageCard; onDecide: (a: TriageAction) => void }) {
  const [revealed, setRevealed] = useState(false);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const knowOpacity = useTransform(x, [20, SWIPE_PX], [0, 1]);
  const learnOpacity = useTransform(x, [-SWIPE_PX, -20], [1, 0]);
  const dropOpacity = useTransform(y, [-SWIPE_PX, -20], [1, 0]);
  const w = card.word;

  const fling = useCallback(
    (action: TriageAction) => {
      const to = action === "drop" ? animate(y, -700, { duration: 0.2 }) : animate(x, action === "know" ? 600 : -600, { duration: 0.2 });
      void to.then(() => onDecide(action));
    },
    [x, y, onDecide],
  );
  const know = useCallback(() => fling("know"), [fling]);
  const learn = useCallback(() => fling("learn"), [fling]);
  const native = useBottomButtons({ text: "✅ Знаю", onClick: know }, { text: "📚 Учу", onClick: learn });

  return (
    <div className="deck">
      <motion.div
        className="card triage-card"
        style={{ x, y, rotate }}
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          const { x: dx, y: dy } = info.offset;
          if (dy < -SWIPE_PX && Math.abs(dy) > Math.abs(dx)) fling("drop");
          else if (dx > SWIPE_PX) fling("know");
          else if (dx < -SWIPE_PX) fling("learn");
        }}
      >
        <motion.div className="stamp stamp-know" style={{ opacity: knowOpacity }}>
          ЗНАЮ
        </motion.div>
        <motion.div className="stamp stamp-forgot" style={{ opacity: learnOpacity }}>
          УЧУ
        </motion.div>
        <motion.div className="stamp stamp-drop" style={{ opacity: dropOpacity }}>
          НЕ ДЛЯ МЕНЯ
        </motion.div>

        <div className="front">
          <Title level="1" weight="2">
            {w.term} {w.usefulness ? USEFULNESS[w.usefulness] : ""}
          </Title>
          {transcription(w) && <Text className="hint">{transcription(w)}</Text>}
          <Text className={`triage-translation${revealed ? "" : " hidden"}`} onClick={() => setRevealed(true)}>
            {revealed ? w.translation : "показать перевод"}
          </Text>
        </div>
        {w.context && (
          <Text className="block">
            <b>Где встретилось:</b> <i>{w.context}</i>
          </Text>
        )}
        <Text className="hint triage-by">Добавил(а) {card.addedBy}</Text>
      </motion.div>

      <div className="row">
        <Button mode="bezeled" size="m" onClick={() => void play(card, "uk")}>
          🔊 UK
        </Button>
        <Button mode="bezeled" size="m" onClick={() => void play(card, "us")}>
          🔊 US
        </Button>
        <Button mode="plain" size="m" onClick={() => fling("drop")}>
          🙈 Не для меня
        </Button>
      </div>
      <Text className="hint swipe-hint">→ знаю · ← учу · ↑ не для меня</Text>

      {!native && (
        <div className="actions fixed">
          <div className="row">
            <Button mode="gray" size="l" stretched onClick={learn}>
              📚 Учу
            </Button>
            <Button size="l" stretched onClick={know}>
              ✅ Знаю
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
