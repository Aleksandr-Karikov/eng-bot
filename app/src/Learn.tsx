import { cardAudioPath, preloadAudio } from "./sound";
import { setStudyLanguage, studyLanguage } from "./language";

import { miniApp } from "@telegram-apps/sdk-react";
import { Button, Chip, Placeholder, Progress, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type QueueMode, getMe, getQueue, pictureUrl, sendAnswer, sendDrillAnswer, undoAnswer, type Answer, type Card, type DrillItem, type Me, type QueueItem } from "./api";
import { ChoiceCard } from "./ChoiceCard";
import { TypeCard } from "./TypeCard";
import { LessonButton } from "./LessonButton";
import { SwipeCard } from "./SwipeCard";
import { useBottomButtons } from "./bottomButtons";
import { haptic, notify } from "./telegram";

const MODES: Array<{ id: QueueMode; label: string }> = [
  { id: "all", label: "Всё" },
  { id: "reviews", label: "Повторы" },
  { id: "fresh", label: "Новые" },
  { id: "hard", label: "Трудные" },
];

/** Выбранный режим помним на этом устройстве (если хранилище недоступно — просто «Всё»). */
function savedMode(): QueueMode {
  try {
    const m = localStorage.getItem("wordboss-mode");
    return MODES.some((x) => x.id === m) ? (m as QueueMode) : "all";
  } catch {
    return "all";
  }
}

/** Сколько последних свайпов можно отменить подряд. */
const UNDO_DEPTH = 5;

/** 📚 Карточки: очередь /learn со свайпами. */
export function Learn({ corner, onTriage, onSets }: { corner: ReactNode; onTriage: () => void; onSets: () => void }) {
  const [me, setMe] = useState<Me>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<QueueMode>(savedMode);
  const [done, setDone] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** Отвеченные карточки (последняя — в конце) и их запросы: отмена ждёт, пока ответ дойдёт до сервера. */
  const [history, setHistory] = useState<Array<{ card: Card; sent: Promise<unknown> }>>([]);

  /** Оценки, которые ещё летят на сервер. */
  const pending = useRef(new Set<Promise<unknown>>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Сначала дождаться отправленных оценок: иначе сервер вернёт только что пройденную карточку
      // ещё раз, со старым состоянием, — и ответ на неё получит «Уже учтено».
      await Promise.allSettled([...pending.current]);
      const [info, cards] = await Promise.all([getMe(), getQueue(mode)]);
      setStudyLanguage(info.language);
      setMe(info);
      setQueue(cards);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [mode]);

  useEffect(() => void load(), [load]);

  const changeMode = useCallback((next: QueueMode) => {
    if (next === mode) return;
    haptic.select();
    try {
      localStorage.setItem("wordboss-mode", next);
    } catch {
      // хранилище недоступно — режим просто не запомнится
    }
    setMode(next);
    setLoading(true);
    setQueue([]);
    setDone(0);
    setHistory([]);
  }, [mode]);

  // Картинки текущей и пары следующих карточек — заранее, пока человек вспоминает слово.
  useEffect(() => {
    if (me?.view.picture === false) return;
    for (const next of queue.slice(0, 3)) if (next.kind === "card" && next.word.hasPicture) void pictureUrl(next.cardId);
  }, [queue, me]);

  // Озвучка текущей и пары следующих — тоже заранее: тап по 🔊 (и диктант) играют сразу.
  useEffect(() => {
    if (me?.view.audio === false) return;
    for (const next of queue.slice(0, 3)) {
      if (next.kind === "card") for (const a of studyLanguage().accents) preloadAudio(cardAudioPath(next.cardId, a.key));
    }
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
    pending.current.add(sent);
    void sent.finally(() => pending.current.delete(sent));
    // Вне зачёта отменять нечего — ответ и так не записан.
    if (!card.practice) setHistory((h) => [...h, { card, sent }].slice(-UNDO_DEPTH));
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

  const count = (id: QueueMode) =>
    !me ? undefined : id === "all" ? me.due.review + me.due.fresh : id === "reviews" ? me.due.review : id === "fresh" ? me.due.fresh : undefined;
  const modes = (
    <div className="chips modes">
      {MODES.map((m) => (
        <Chip key={m.id} mode={mode === m.id ? "mono" : "outline"} onClick={() => changeMode(m.id)}>
          {m.label}
          {count(m.id) ? ` ${count(m.id)}` : ""}
        </Chip>
      ))}
    </div>
  );

  if (error || (loading && !card) || !card) {
    return (
      <div className="screen">
        {header}
        {modes}
        {error ? (
          <Placeholder header="Не получилось загрузить" description={error} />
        ) : loading ? (
          <div className="center">
            <Spinner size="l" />
          </div>
        ) : (
          <Done done={done} onSets={onSets} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      {modes}
      {mode === "hard" && <Text className="hint practice-note">🔁 Вне зачёта: ответы не сдвигают повторения</Text>}
      <Progress value={total ? (done / total) * 100 : 0} />
      {card.kind === "drill" ? (
        <ChoiceCard
          key={card.id}
          title={`🧠 Работа над ошибками · ${card.category}`}
          quiz={card}
          onAnswer={(correct) => answerDrill(card, correct)}
          onNext={advance}
        />
      ) : card.stage === "cloze" || card.stage === "listen" || card.stage === "sentence" ? (
        <TypeCard
          key={`${card.cardId}-${card.reps}`}
          card={card}
          // Оценил сервер при проверке — в историю для ↩️ (запрос уже прошёл).
          onRated={() => !card.practice && setHistory((h) => [...h, { card, sent: Promise.resolve() }].slice(-UNDO_DEPTH))}
          onRateSelf={(a) => rate(card, a)}
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
function Done({ done, onSets }: { done: number; onSets: () => void }) {
  const native = useBottomButtons({ text: "Закрыть", onClick: () => miniApp.close() });
  return (
    <Placeholder
      header={done ? `🎉 Готово! Повторено: ${done}` : "Сейчас нечего повторять 👌"}
      description="Новые слова и повторения появятся сами — бот напомнит. А пока можно послушать слова на ходу."
      action={
        <div className="actions">
          <Button mode="bezeled" size="m" stretched onClick={onSets}>
            📦 Взять слова из готового набора
          </Button>
          <LessonButton />
          {!native && (
            <Button size="l" stretched onClick={() => miniApp.close()}>
              Закрыть
            </Button>
          )}
        </div>
      }
    />
  );
}
