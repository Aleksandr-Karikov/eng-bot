import { miniApp } from "@telegram-apps/sdk-react";
import { Button, Placeholder, Progress, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { getMe, getQueue, pictureUrl, sendAnswer, type Answer, type Card, type Me } from "./api";
import { SwipeCard } from "./SwipeCard";
import { useBottomButtons } from "./bottomButtons";
import { haptic } from "./telegram";

/** 📚 Карточки: очередь /learn со свайпами. */
export function Learn() {
  const [me, setMe] = useState<Me>();
  const [queue, setQueue] = useState<Card[]>([]);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

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
    for (const next of queue.slice(0, 3)) if (next.word.hasPicture) void pictureUrl(next.cardId);
  }, [queue, me]);

  /** Ответ — сразу следующая карточка, запрос уходит в фоне; очередь кончилась — догружаем. */
  const answer = useCallback(
    (card: Card, value: Answer) => {
      haptic.tap(value === "again" ? "medium" : "light");
      void sendAnswer(card, value).catch(() => {});
      setDone((n) => n + 1);
      setQueue((q) => {
        const rest = q.slice(1);
        if (rest.length === 0) void load();
        return rest;
      });
    },
    [load],
  );

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (loading && queue.length === 0) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }

  const card = queue[0];
  const total = done + queue.length;
  if (!card) return <Done done={done} />;

  return (
    <div className="screen">
      <header className="top">
        <Text weight="2">{me?.room ?? "WordBoss"}</Text>
        <Text className="hint">
          {done} / {total}
        </Text>
      </header>
      <Progress value={total ? (done / total) * 100 : 0} />
      <SwipeCard key={`${card.cardId}-${card.reps}`} card={card} view={me?.view} onAnswer={(a) => answer(card, a)} />
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
