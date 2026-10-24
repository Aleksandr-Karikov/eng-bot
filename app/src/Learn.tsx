import { miniApp } from "@telegram-apps/sdk-react";
import { Button, Placeholder, Progress, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getMe, getQueue, pictureUrl, sendAnswer, sendDrillAnswer, undoAnswer, type Answer, type Card, type DrillItem, type Me, type QueueItem } from "./api";
import { ChoiceCard } from "./ChoiceCard";
import { SwipeCard } from "./SwipeCard";
import { useBottomButtons } from "./bottomButtons";
import { haptic, notify } from "./telegram";

/** Сколько последних свайпов можно отменить подряд. */
const UNDO_DEPTH = 5;

/** 📚 Карточки: очередь /learn со свайпами. */
export function Learn({ corner, onTriage }: { corner: ReactNode; onTriage: () => void }) {
  const [me, setMe] = useState<Me>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** Отвеченные карточки (последняя — в конце) и их запросы: отмена ждёт, пока ответ дойдёт до сервера. */
  const [history, setHistory] = useState<Array<{ card: Card; sent: Promise<unknown> }>>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [info, cards] = await Promise.all([getMe(), getQueue()]);
      setMe(info);
      setQueue(cards);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void load(), [load]);

  // Картинки текущей и пары следующих карточек — заранее, пока человек вспоминает слово.
  useEffect(() => {
    if (me?.view.picture === false) return;
    for (const next of queue.slice(0, 3)) if (next.kind === "card" && next.word.hasPicture) void pictureUrl(next.cardId);
  }, [queue, me]);

  /** Следующее задание; очередь кончилась — догружаем. */
  const advance = useCallback(() => {
    setDone((n) => n + 1);
    setQueue((q) => {
      const rest = q.slice(1);
      if (rest.length === 0) void load();
      return rest;
    });
  }, [load]);

  /** Оценка карточки уходит в фоне; её можно отменить ↩️. */
  const rate = useCallback((card: Card, value: Answer) => {
    const sent = sendAnswer(card, value).catch(() => {});
    setHistory((h) => [...h, { card, sent }].slice(-UNDO_DEPTH));
  }, []);

  /** Свайп — сразу следующая карточка. */
  const answer = useCallback(
    (card: Card, value: Answer) => {
      haptic.tap(value === "again" ? "medium" : "light");
      rate(card, value);
      advance();
    },
    [rate, advance],
  );

  /** 🧠 Ответ на вопрос по ошибкам: счёт темы — в разбор, если он что-то говорит. */
  const answerDrill = useCallback(async (item: DrillItem, correct: boolean) => {
    const progress = await sendDrillAnswer(item, correct).catch(() => null);
    if (!progress) return;
    if (progress.resolved) return <Text className="block">🎉 Тема «{progress.category}» отработана — больше её не предлагаю.</Text>;
    if (!correct) return <Text className="hint">🧠 Тема «{progress.category}»: счёт заново.</Text>;
  }, []);

  /** ↩️ Свайпнул не туда — ответ отменяется, карточка снова сверху. */
  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    haptic.tap("light");
    try {
      await last.sent;
      await undoAnswer(last.card);
      setQueue((q) => [last.card, ...q.filter((c) => c.kind !== "card" || c.cardId !== last.card.cardId)]);
      setDone((n) => Math.max(0, n - 1));
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [history]);

  const card = queue[0];
  const total = done + queue.length;
  // Кнопки в углу видны всегда — и на загрузке, и на «Готово», чтобы до слов и настроек можно было дойти.
  const header = (
    <header className="top">
      <Text weight="2" className="top-title">
        {me?.room ?? "WordBoss"}
      </Text>
      <div className="top-right">
        {card && (
          <Text className="hint top-count">
            {done} / {total}
          </Text>
        )}
        {history.length > 0 && (
          <button className="corner-button" aria-label="Отменить последний ответ" onClick={() => void undo()}>
            ↩️
          </button>
        )}
        {me && me.triage > 0 && (
          <button className="corner-button corner-badge" aria-label="Новые слова от друзей" onClick={onTriage}>
            🆕<span className="badge">{me.triage > 99 ? "99+" : me.triage}</span>
          </button>
        )}
        {corner}
      </div>
    </header>
  );

  if (error || (loading && !card) || !card) {
    return (
      <div className="screen">
        {header}
        {error ? (
          <Placeholder header="Не получилось загрузить" description={error} />
        ) : loading ? (
          <div className="center">
            <Spinner size="l" />
          </div>
        ) : (
          <Done done={done} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      <Progress value={total ? (done / total) * 100 : 0} />
      {card.kind === "drill" ? (
        <ChoiceCard
          key={card.id}
          title={`🧠 Работа над ошибками · ${card.category}`}
          quiz={card}
          onAnswer={(correct) => answerDrill(card, correct)}
          onNext={advance}
        />
      ) : card.stage === "collocation" && card.quiz ? (
        <ChoiceCard
          key={`${card.cardId}-${card.reps}`}
          title={
            <>
              🔗 Какое слово подходит к <b>{card.word.term}</b>?
            </>
          }
          quiz={card.quiz}
          extra={
            card.quiz.items.length > 0 && (
              <ul className="collocation-list">
                {card.quiz.items.map((c) => (
                  <li key={c.phrase}>
                    <b>{c.phrase}</b> — {c.translation}
                  </li>
                ))}
              </ul>
            )
          }
          onAnswer={(correct) => rate(card, correct ? "good" : "again")}
          onNext={advance}
        />
      ) : (
        <SwipeCard key={`${card.cardId}-${card.reps}`} card={card} view={me?.view} onAnswer={(a) => answer(card, a)} />
      )}
    </div>
  );
}

/** Конец очереди: нативная кнопка «Закрыть» внизу (или своя — вне Telegram). */
function Done({ done }: { done: number }) {
  const native = useBottomButtons({ text: "Закрыть", onClick: () => miniApp.close() });
  return (
    <Placeholder
      header={done ? `🎉 Готово! Повторено: ${done}` : "Сейчас нечего повторять 👌"}
      description="Новые слова и повторения появятся сами — бот напомнит."
      action={
        native ? undefined : (
          <Button size="l" stretched onClick={() => miniApp.close()}>
            Закрыть
          </Button>
        )
      }
    />
  );
}
