import { CorrectionForm } from "./CorrectionForm";
import { cardAudioPath, preloadAudio } from "./sound";
import { setStudyLanguage, studyLanguage } from "./language";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { miniApp } from "@telegram-apps/sdk-react";
import { Button, Chip, Placeholder, Progress, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type QueueMode, getBoss, getMe, getQueue, pictureUrl, sendAnswer, sendDrillAnswer, undoAnswer, wordAction, type CardAnswer, type Boss, type Card, type DrillItem, type Me, type QueueItem } from "./api";
import { ChoiceCard } from "./ChoiceCard";
import { TypeCard } from "./TypeCard";
import { DialogueCard } from "./DialogueCard";
import { LessonButton } from "./LessonButton";
import { SwipeCard } from "./SwipeCard";
import { useBottomButtons } from "./bottomButtons";
import { IconChevronDown, IconChevronUp, IconPencil, IconUndo } from "./icons";
import { haptic, notify } from "./telegram";

const MODES: Array<{ id: QueueMode; label: string }> = [
  { id: "all", label: "Всё" },
  { id: "reviews", label: "Повторы" },
  { id: "fresh", label: "Новые" },
  { id: "hard", label: "Трудные" },
];

/** Свёрнута ли шапка с режимами — помним на устройстве: кто свернул ради места, не хочет сворачивать снова. */
function savedFolded(): boolean {
  try {
    return localStorage.getItem("wordboss-header-folded") === "1";
  } catch {
    return false;
  }
}

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
type AnswerResult = Awaited<ReturnType<typeof sendAnswer>>;

/** Карточки: очередь /learn со свайпами. */
export function Learn({ corner, onSets, onSettings }: { corner: ReactNode; onSets: (setId?: number) => void; onSettings: () => void }) {
  const [correcting, setCorrecting] = useState<Card["word"]>();
  const [me, setMe] = useState<Me>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<QueueMode>(savedMode);
  const [done, setDone] = useState(0);
  const [dialogueVersion, setDialogueVersion] = useState(0);
  const [damageBursts, setDamageBursts] = useState<Array<{ id: number; hp: number }>>([]);
  const damageSequence = useRef(0);
  const reducedMotion = useReducedMotion();
  const showDamage = useCallback((hp: number) => {
    if (hp === 0) return;
    const id = ++damageSequence.current;
    setDamageBursts((bursts) => [...bursts, { id, hp }].slice(-6));
  }, []);
  /** Шапка с режимами свёрнута — на карточку уходит больше места. */
  const [headerFolded, setHeaderFolded] = useState(savedFolded);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  /** Отвеченные карточки (последняя — в конце) и их запросы: отмена ждёт, пока ответ дойдёт до сервера. */
  const [history, setHistory] = useState<Array<{ card: Card; sent: Promise<AnswerResult | undefined>; dropped?: boolean }>>([]);

  /** Оценки, которые ещё летят на сервер. */
  const pending = useRef(new Set<Promise<unknown>>());
  const loadVersion = useRef(0);

  const load = useCallback(async (extra = false) => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      // Сначала дождаться отправленных оценок: иначе сервер вернёт только что пройденную карточку
      // ещё раз, со старым состоянием, — и ответ на неё получит «Уже учтено».
      await Promise.allSettled([...pending.current]);
      const [info, cards] = await Promise.all([getMe(), getQueue(mode, extra)]);
      if (version !== loadVersion.current) return;
      setStudyLanguage(info.language);
      setMe(info);
      setQueue(cards);
      setError(undefined);
    } catch (err) {
      if (version === loadVersion.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (version === loadVersion.current) setLoading(false);
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
    loadVersion.current++;
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

  // Озвучка текущей и пары следующих — тоже заранее: тап по кнопке озвучки (и диктант) играют сразу.
  // Выбранный вариант озвучивается сам при показе ответа, поэтому его грузим первым.
  useEffect(() => {
    if (me?.view.audio === false) return;
    const accents = me?.voice ? [me.voice, ...studyLanguage().accents.map((a) => a.key).filter((a) => a !== me.voice)] : studyLanguage().accents.map((a) => a.key);
    for (const next of queue.slice(0, 3)) {
      if (next.kind === "card") for (const a of accents) preloadAudio(cardAudioPath(next.cardId, a));
    }
  }, [queue, me]);

  /** Следующее задание; очередь кончилась — догружаем. */
  const advance = useCallback(() => {
    setDone((n) => n + 1);
    const [current, next] = queue;
    // Ответ на повтор мог вернуть слово в изучение и занять свободное место.
    const nextIsFirstNew = next?.kind === "card" && next.isNew && !next.extra && (current?.kind !== "card" || !current.isNew);
    if (!next || nextIsFirstNew) {
      setQueue([]);
      void load();
    } else {
      setQueue((q) => q.slice(1));
    }
  }, [load, queue]);

  /** Оценка карточки уходит в фоне; её можно отменить. */
  const rate = useCallback((card: Card, value: CardAnswer) => {
    const sent = sendAnswer(card, value).then((r) => {
      showDamage(r.damage);
      if (r.result !== "ok") setHistory((h) => h.filter((entry) => entry.sent !== sent));
      if (r.result === "stale") notify(card.needsDecision ? "Карточка уже изменилась" : "Ответ уже учтён — повторный урон не начислен");
      if (r.result === "waiting") notify("Слово осталось в очереди.");
      return r;
    }).catch(() => {
      setHistory((h) => h.filter((entry) => entry.sent !== sent));
      notify(value === "drop" ? "Не получилось убрать слово. Оно останется в очереди." : "Ответ не сохранён. Карточка останется в очереди.");
      return undefined;
    });
    pending.current.add(sent);
    void sent.finally(() => pending.current.delete(sent));
    // Вне зачёта отменять нечего — ответ и так не записан.
    if (!card.practice) setHistory((h) => [...h, { card, sent, dropped: value === "drop" }].slice(-UNDO_DEPTH));
    return sent;
  }, [showDamage]);

  /** Свайп — сразу следующая карточка. */
  const answer = useCallback(
    (card: Card, value: CardAnswer) => {
      haptic.tap(value === "again" ? "medium" : "light");
      const sent = rate(card, value);
      if (!card.needsDecision) {
        advance();
        return;
      }
      const version = loadVersion.current;
      return sent.then((result) => {
        if (version !== loadVersion.current) return;
        if (result?.result === "ok") advance();
        if (result?.result === "stale" || result?.result === "waiting") {
          if (card.extra) return advance();
          setQueue([]);
          void load();
        }
      });
    },
    [rate, advance, load],
  );

  /** Ответ на вопрос по ошибкам: счёт темы — в разбор, если он что-то говорит. */
  const answerDrill = useCallback(async (item: DrillItem, correct: boolean) => {
    const progress = await sendDrillAnswer(item, correct).catch(() => null);
    if (!progress) return;
    if (progress.resolved) return <Text className="block">Тема «{progress.category}» отработана — больше её не предлагаю.</Text>;
    if (!correct) return <Text className="hint">Тема «{progress.category}»: счёт заново.</Text>;
  }, []);

  /** Свайпнул не туда — ответ отменяется, карточка снова сверху. */
  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    haptic.tap("light");
    try {
      const recorded = await last.sent;
      if (recorded?.result !== "ok") return;
      if (last.dropped) {
        await wordAction(last.card.word.id, "restore");
        setDone((n) => Math.max(0, n - 1));
        setQueue([]);
        await load();
        return;
      }
      await undoAnswer(last.card);
      showDamage(-recorded.damage);
      if (last.card.stage === "sentence") setDialogueVersion((v) => v + 1);
      setQueue((q) => [last.card, ...q.filter((c) => c.kind !== "card" || c.cardId !== last.card.cardId)]);
      setDone((n) => Math.max(0, n - 1));
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [history, load, showDamage]);

  const card = queue[0];
  const typedRated = (card: Card, hp: number) => {
    showDamage(hp);
    if (!card.practice) setHistory((h) => [...h, { card, sent: Promise.resolve({ result: "ok" as const, damage: hp }) }].slice(-UNDO_DEPTH));
  };
  const total = done + queue.length;
  // Кнопки в углу видны всегда — и на загрузке, и на «Готово», чтобы до слов и настроек можно было дойти.
  const fold = () => {
    const next = !headerFolded;
    setHeaderFolded(next);
    try {
      localStorage.setItem("wordboss-header-folded", next ? "1" : "0");
    } catch {
      // хранилище недоступно — настройка просто не запомнится
    }
  };
  const header = (
    <header className="top">
      {/* Свернуть шапку с режимами: на телефоне каждая полоса отнимает место у карточки.
          Без карточки сворачивать нечего — на «Готово» кнопки нет. */}
      {card ? (
        <button
          className="corner-button fold-button"
          aria-label={headerFolded ? "Показать режимы" : "Свернуть шапку"}
          aria-expanded={!headerFolded}
          onClick={fold}
        >
          {headerFolded ? <IconChevronDown size={16} /> : <IconChevronUp size={16} />}
        </button>
      ) : null}
      <Text weight="2" className="top-title">
        {me?.room ?? "WordBoss"}
        {/* Шапка свёрнута — режим не виден, а знать его надо: показываем рядом с названием. */}
        {headerFolded && mode !== "all" ? ` · ${MODES.find((m) => m.id === mode)?.label ?? ""}` : ""}
      </Text>
      <div className="top-right">
        {card && (
          <Text className="hint top-count">
            {done} / {total}
          </Text>
        )}
        {history.length > 0 && (
          <button className="corner-button" aria-label="Отменить последний ответ" onClick={() => void undo()}>
            <IconUndo size={18} />
          </button>
        )}
        {card?.kind === "card" && (
          <button className="corner-button" aria-label="Исправить слово с ИИ" onClick={() => setCorrecting(card.word)}>
            <IconPencil size={18} />
          </button>
        )}
        {corner}
      </div>
    </header>
  );

  const damageEffect = me?.boss ? (
    <div className="damage-bursts" role="status" aria-live="polite" aria-atomic="false">
      <AnimatePresence>
        {damageBursts.map(({ id, hp }) => (
          <motion.div
            key={id}
            className={`damage-burst${hp < 0 ? " damage-burst-undo" : ""}`}
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.65, y: reducedMotion ? 0 : 24 }}
            animate={{ opacity: [0, 1, 1, 0], scale: reducedMotion ? 1 : [0.65, 1.18, 1, 1], y: reducedMotion ? 0 : [24, 0, -18, -70], x: reducedMotion ? 0 : ((id % 3) - 1) * 22 }}
            transition={{ duration: 1.5, times: [0, 0.15, 0.65, 1] }}
            onAnimationComplete={() => setDamageBursts((bursts) => bursts.filter((b) => b.id !== id))}
          >
            {hp > 0 ? "+" : ""}{hp} <small>{me.bankDamage ? "HP в запас" : "HP"}</small>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ) : null;

  const count = (id: QueueMode) =>
    !me ? undefined : id === "all" ? me.due.review + me.due.fresh : id === "reviews" ? me.due.review : id === "fresh" ? me.due.fresh : undefined;
  // На пустом экране режимы нужны, чтобы из «Новые» можно было перейти к повторам.
  const modes = headerFolded && card ? null : (
    <div className="chips modes">
      {MODES.map((m) => (
        <Chip key={m.id} mode={mode === m.id ? "mono" : "outline"} onClick={() => changeMode(m.id)}>
          {m.label}
          {count(m.id) ? ` ${count(m.id)}` : ""}
        </Chip>
      ))}
    </div>
  );

  if (correcting) return <CorrectionForm word={correcting} onDone={(saved) => {
    setCorrecting(undefined);
    if (saved) {
      setHistory([]);
      setQueue([]);
      void load();
    }
  }} />;

  if (error || (loading && !card) || !card) {
    return (
      <div className="screen">
        {header}
        {modes}
      {damageEffect}
        {error ? (
          <Placeholder header="Не получилось загрузить" description={error} action={<Button onClick={() => void load()}>Попробовать снова</Button>} />
        ) : loading ? (
          <div className="center">
            <Spinner size="l" />
          </div>
        ) : (
          <Done done={done} me={me} mode={mode} onSets={onSets} onExtra={() => void load(true)} onSettings={onSettings} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      {modes}
      {damageEffect}
      {mode === "hard" && <Text className="hint practice-note">Вне зачёта: ответы не сдвигают повторения</Text>}
      {card.kind === "card" && card.extra && <Text className="hint practice-note">Сверх плана</Text>}
      <Progress value={total ? (done / total) * 100 : 0} />
      {card.kind === "drill" ? (
        <ChoiceCard
          key={card.id}
          title={`Работа над ошибками · ${card.category}`}
          quiz={card}
          onAnswer={(correct) => answerDrill(card, correct)}
          onNext={advance}
        />
      ) : card.stage === "sentence" ? (
        <DialogueCard
          key={`${card.cardId}-${card.reps}-${dialogueVersion}`}
          card={card}
          onRated={(hp) => typedRated(card, hp)}
          onNext={advance}
          onFallback={() => setQueue((q) => q[0] === card ? [{ ...card, stage: "en_ru" }, ...q.slice(1)] : q)}
        />
      ) : card.stage === "cloze" || card.stage === "listen" ? (
        <TypeCard
          key={`${card.cardId}-${card.reps}`}
          card={card}
          voice={me?.voice}
          // Оценил сервер при проверке — в историю для отмены (запрос уже прошёл).
          onRated={(hp) => typedRated(card, hp)}
          onRateSelf={(a) => void rate(card, a)}
          onNext={advance}
        />
      ) : card.stage === "collocation" && card.quiz ? (
        <ChoiceCard
          key={`${card.cardId}-${card.reps}`}
          title={
            <>
              Какое слово подходит к <b>{card.word.term}</b>?
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
          onAnswer={(correct) => void rate(card, correct ? "good" : "again")}
          onNext={advance}
        />
      ) : (
        <SwipeCard key={`${card.cardId}-${card.reps}`} card={card} view={me?.view} voice={me?.voice} onAnswer={(a) => answer(card, a)} />
      )}
    </div>
  );
}

/**
 * Конец очереди. Два разных случая, и раньше они выглядели одинаково:
 *
 * - **всё повторил** (`total > 0`) — честное «появятся сами, бот напомнит», так и есть;
 * - **нечего учить** (`total === 0`) — новичок, который только что открыл бота и увидел пустоту.
 *   Ему нельзя говорить «жди»: ждать нечего, слов нет вовсе. Вместо этого один тап до готового
 *   набора A1, но только предложением — «Позже» остаётся на месте, никто ничего не навязывает.
 *
 * Нативная кнопка «Закрыть» внизу — или своя, вне Telegram.
 */
function Done({ done, me, mode, onSets, onExtra, onSettings }: {
  done: number;
  me?: Me;
  mode: QueueMode;
  onSets: (setId?: number) => void;
  onExtra: () => void;
  onSettings: () => void;
}) {
  const native = useBottomButtons({ text: "Закрыть", onClick: () => miniApp.close() });
  const starter = me?.starterSet;
  /**
   * Урон этого захода. Показываем именно здесь, на «Готово»: человек уходит с мыслью «я снял 12 HP»,
   * а не с сухим отчётом. Вкладку босса ещё надо не забыть открыть — экран «Готово» забыть нельзя.
   */
  const [boss, setBoss] = useState<Boss>();
  useEffect(() => {
    if (!me?.boss) return;
    getBoss()
      .then((state) => setBoss(state.boss))
      .catch(() => {});
  }, [me?.boss]);

  if (starter && done === 0) {
    return (
      <Placeholder
        header="Пока нечего учить"
        description={`Возьми готовый набор — «${starter.title}», ${starter.total} слов. Листаешь: знаю / учу / не для меня. Взятое сразу появится здесь.`}
        action={
          <div className="actions">
            <Button size="l" stretched onClick={() => onSets(starter.id)}>
              Начать с «{starter.title}»
            </Button>
            <Button mode="bezeled" size="m" stretched onClick={() => onSets()}>
              Выбрать другой набор
            </Button>
            {!native && (
              <Button mode="plain" size="m" stretched onClick={() => miniApp.close()}>
                Позже
              </Button>
            )}
          </div>
        }
      />
    );
  }

  const notice = mode !== "hard" ? me?.limitNotices?.[mode] : undefined;
  const extraLabel = mode !== "hard" ? me?.extraLabels?.[mode] : undefined;
  const message = notice ? `${notice} Лимиты можно изменить в настройках.` : "Новые слова и повторения появятся сами — бот напомнит.";
  const header = notice ? "Лимит обучения достигнут" : mode === "fresh" ? "Сейчас нет новых карточек" : "Сейчас нечего повторять";
  return (
    <Placeholder
      header={done ? `Готово! Пройдено карточек: ${done}` : header}
      description={
        boss
          ? `Босс недели: снято ${Math.round(Math.min(1, boss.damage) * 100)}% HP${boss.phase === "dead" ? " — он повержен" : `, осталось ${boss.hp}`}. ${message}`
          : message
      }
      action={
        <div className="actions">
          {notice ? (
            <>
              <Button mode="bezeled" size="m" stretched onClick={onExtra}>{extraLabel ?? "Ещё карточки"}</Button>
              <Button mode="plain" size="m" stretched onClick={onSettings}>Настройки лимитов</Button>
            </>
          ) : (
            <>
              <Button mode="bezeled" size="m" stretched onClick={() => onSets()}>Взять слова из готового набора</Button>
              <LessonButton />
            </>
          )}
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
