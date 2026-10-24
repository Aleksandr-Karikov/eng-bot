import { Button, Placeholder, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { getTriage, sendTriage, type TriageAction, type TriageCard } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { DeckCard } from "./Deck";
import { haptic, notify, useBackButton } from "./telegram";

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
      {card ? (
        <DeckCard
          key={card.cardId}
          word={{ ...card.word, audio: `/api/audio?word=${card.word.id}` }}
          footer={`Добавил(а) ${card.addedBy}`}
          onDecide={(a) => decide(card, a)}
        />
      ) : (
        <AllDone onExit={onExit} />
      )}
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

