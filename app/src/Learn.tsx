import { CorrectionForm } from "./CorrectionForm";
import { cardAudioPath, preloadAudio } from "./sound";
import { setStudyLanguage, studyLanguage } from "./language";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button, Chip, Placeholder, Progress, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type QueueMode, getMe, getQueue, pictureUrl, sendAnswer, sendDrillAnswer, undoAnswer, wordAction, type CardAnswer, type Card, type DrillItem, type Me, type QueueItem } from "./api";
import { ChoiceCard } from "./ChoiceCard";
import { TypeCard } from "./TypeCard";
import { DialogueCard } from "./DialogueCard";
import { LessonButton } from "./LessonButton";
import { SwipeCard } from "./SwipeCard";
import { IconChevronDown, IconChevronUp, IconPencil, IconUndo } from "./icons";
import { haptic, notify } from "./telegram";

const MODES: Array<{ id: QueueMode; label: string }> = [
  { id: "all", label: "Всё" },
  { id: "reviews", label: "Повторы" },
  { id: "fresh", label: "Новые" },
  { id: "hard", label: "Без зачёта" },
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
type AnswerResult = Pick<Awaited<ReturnType<typeof sendAnswer>>, "result" | "energy">;

/** Карточки: очередь /learn со свайпами. */
export function Learn({ visible, corner, onSets, onSettings, onBoss, onLearning }: {
  visible: boolean; corner: ReactNode; onSets: (setId?: number) => void; onSettings: () => void; onBoss: () => void; onLearning: () => void;
}) {
  const [correcting, setCorrecting] = useState<Card["word"]>();
  const [me, setMe] = useState<Me>();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [mode, setMode] = useState<QueueMode>(savedMode);
  const [done, setDone] = useState(0);
  const [sessionEnergy, setSessionEnergy] = useState(0);
  const [dialogueVersion, setDialogueVersion] = useState(0);
  const [energyBursts, setEnergyBursts] = useState<Array<{ id: number; energy: number }>>([]);
  const damageSequence = useRef(0);
  const reducedMotion = useReducedMotion();
  const showEnergy = useCallback((energy: number) => {
    if (energy === 0) return;
    setSessionEnergy((total) => total + energy);
    const id = ++damageSequence.current;
    setEnergyBursts((bursts) => [...bursts, { id, energy }].slice(-6));
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
  const requestedExtra = useRef(false);
  const sessionVersion = useRef(0);
  const suspended = useRef(false);

  const load = useCallback(async (extra = false) => {
    const version = ++loadVersion.current;
    requestedExtra.current = extra;
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

  useEffect(() => {
    if (!visible) {
      suspended.current = true;
      return;
    }
    if (!suspended.current) {
      void load();
      return;
    }
    suspended.current = false;
    // Освежаем сроки и лимиты, сохраняя итог занятия и возможность отмены.
    let active = true;
    getMe().then((info) => {
      if (!active) return;
      setStudyLanguage(info.language);
      setMe(info);
    }).catch(() => {});
    return () => { active = false; };
  }, [load, visible]);

  const changeMode = useCallback((next: QueueMode) => {
    if (next === mode) return;
    haptic.select();
    try {
      localStorage.setItem("wordboss-mode", next);
    } catch {
      // хранилище недоступно — режим просто не запомнится
    }
    loadVersion.current++;
    sessionVersion.current++;
    setMode(next);
    setLoading(true);
    setQueue([]);
    setDone(0);
    setSessionEnergy(0);
    setEnergyBursts([]);
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
    const session = sessionVersion.current;
    const sent = sendAnswer(card, value).then((r) => {
      if (session === sessionVersion.current) showEnergy(r.energy ?? 0);
      if (r.result !== "ok") setHistory((h) => h.filter((entry) => entry.sent !== sent));
      if (r.result === "stale") notify(card.needsDecision ? "Карточка уже изменилась" : "Ответ уже учтён");
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
  }, [showEnergy]);

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
    const session = sessionVersion.current;
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
      if (session !== sessionVersion.current) return;
      showEnergy(-(recorded.energy ?? 0));
      if (last.card.stage === "sentence") setDialogueVersion((v) => v + 1);
      setQueue((q) => [last.card, ...q.filter((c) => c.kind !== "card" || c.cardId !== last.card.cardId)]);
      setDone((n) => Math.max(0, n - 1));
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [history, load, showEnergy]);

  const card = queue[0];
  const session = sessionVersion.current;
  const typedRated = (card: Card, energy: number) => {
    if (session !== sessionVersion.current) return;
    showEnergy(energy);
    if (!card.practice) setHistory((h) => [...h, { card, sent: Promise.resolve({ result: "ok" as const, energy }) }].slice(-UNDO_DEPTH));
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
        {energyBursts.map(({ id, energy }) => (
          <motion.div
            key={id}
            className={`damage-burst${energy < 0 ? " damage-burst-undo" : ""}`}
            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.65, y: reducedMotion ? 0 : 24 }}
            animate={{ opacity: [0, 1, 1, 0], scale: reducedMotion ? 1 : [0.65, 1.18, 1, 1], y: reducedMotion ? 0 : [24, 0, -18, -70], x: reducedMotion ? 0 : ((id % 3) - 1) * 22 }}
            transition={{ duration: 1.5, times: [0, 0.15, 0.65, 1] }}
            onAnimationComplete={() => setEnergyBursts((bursts) => bursts.filter((b) => b.id !== id))}
          >
            {energy > 0 ? "+" : ""}{energy} <small>⚡</small>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  ) : null;

  const count = (id: QueueMode) =>
    !me ? undefined : id === "all" ? me.due.review + me.due.fresh : id === "reviews" ? me.due.review : id === "fresh" ? me.due.fresh : undefined;
  // На пустом экране режимы нужны, чтобы из «Новые» можно было перейти к повторам.
  const modes = headerFolded && card ? null : (
    <div className="chips modes" role="group" aria-label="Режим обучения">
      {MODES.map((m) => (
        <Chip key={m.id} Component="button" type="button" className="word-filter"
          aria-pressed={mode === m.id} mode={mode === m.id ? "mono" : "outline"} onClick={() => changeMode(m.id)}>
          {m.label}
          {count(m.id) ? ` ${count(m.id)}` : ""}
        </Chip>
      ))}
    </div>
  );

  if (!visible) return null;

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
      <div className="screen learn-status">
        {header}
        {modes}
        {damageEffect}
        {error ? (
          <Placeholder header="Не получилось загрузить" description={error}
            action={<Button onClick={() => void load(requestedExtra.current)}>Попробовать снова</Button>} />
        ) : loading ? (
          <div className="center">
            <Spinner size="l" />
          </div>
        ) : (
          <Done done={done} energy={sessionEnergy} me={me} mode={mode}
            onSets={onSets} onContinue={() => void load()} onMode={changeMode} onExtra={() => void load(true)}
            onSettings={onSettings} onBoss={onBoss} onLearning={onLearning} />
        )}
      </div>
    );
  }

  return (
    <div className="screen">
      {header}
      {modes}
      {damageEffect}
      {mode === "hard" && <Text className="hint practice-note">Расписание повторений не меняется</Text>}
      {card.kind === "card" && card.extra && <Text className="hint practice-note">Сверх плана · ответы засчитываются</Text>}
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
          onRated={(energy) => typedRated(card, energy)}
          onNext={advance}
          onFallback={() => setQueue((q) => q[0] === card ? [{ ...card, stage: "en_ru" }, ...q.slice(1)] : q)}
        />
      ) : card.stage === "cloze" || card.stage === "listen" ? (
        <TypeCard
          key={`${card.cardId}-${card.reps}`}
          card={card}
          voice={me?.voice}
          // Оценил сервер при проверке — в историю для отмены (запрос уже прошёл).
          onRated={(energy) => typedRated(card, energy)}
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
 *   набора A1.
 */
function Done({ done, energy, me, mode, onSets, onContinue, onMode, onExtra, onSettings, onBoss, onLearning }: {
  done: number;
  energy: number;
  me?: Me;
  mode: QueueMode;
  onSets: (setId?: number) => void;
  onContinue: () => void;
  onMode: (mode: QueueMode) => void;
  onExtra: () => void;
  onSettings: () => void;
  onBoss: () => void;
  onLearning: () => void;
}) {
  const starter = me?.starterSet;

  if (starter && done === 0) {
    return (
      <Placeholder className="learn-result"
        header="Пока нечего учить"
        description={`Возьми готовый набор — «${starter.title}», ${starter.total} слов. Листаешь: знаю / учу / не для меня. Взятое сразу появится здесь.`}
        action={
          <div className="actions learn-result-actions">
            <Button size="l" stretched onClick={() => onSets(starter.id)}>
              Начать с «{starter.title}»
            </Button>
            <Button mode="plain" size="m" stretched onClick={() => onSets()}>Выбрать другой набор</Button>
          </div>
        }
      />
    );
  }

  const notice = mode !== "hard" ? me?.limitNotices?.[mode] : undefined;
  const extraLabel = mode !== "hard" ? me?.extraLabels?.[mode] : undefined;
  const { review = 0, fresh = 0, limits } = me?.due ?? {};
  const ready = { all: review + fresh, reviews: review, fresh, hard: 0 }[mode];
  const otherMode = mode === "fresh" && review ? "reviews" : mode === "reviews" && fresh ? "fresh" : undefined;
  const showExtra = !ready && Boolean(notice && extraLabel);
  const continuation = ready ? { label: "Продолжить занятие", run: onContinue }
    : otherMode && {
      label: otherMode === "reviews" ? `К повторам · ${review}` : `К новым словам · ${fresh}`,
      run: () => onMode(otherMode),
    };
  const emptyHeader = { all: "Сейчас нечего повторять", reviews: "Сейчас нечего повторять", fresh: "Сейчас нет новых карточек", hard: "Сейчас нет трудных карточек" };
  return (
    <Placeholder
      className="learn-result"
      header={done ? `Готово! Пройдено карточек: ${done}` : notice ? "Лимит обучения достигнут" : emptyHeader[mode]}
      description={<>
        {me?.boss && energy > 0 && <span className="result-stat">За занятие +{energy.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} ⚡</span>}
        {notice && <span className="result-detail">{notice}</span>}
        {notice && limits && <span className="result-detail">
          {limits.dailyLimit > 0 ? `Сегодня начато ${limits.introduced} из ${limits.dailyLimit} новых слов.` : "Дневной лимит выключен."}
          <br />В «Учу» занято {limits.active} из {limits.activeLimit} мест.
        </span>}
        {mode !== "hard" && me?.nextReview && <span className="result-detail">Следующее повторение {me.nextReview}</span>}
      </>}
      action={
        <div className="actions learn-result-actions">
          {continuation && <Button size="l" stretched onClick={continuation.run}>{continuation.label}</Button>}
          {showExtra && <Button size="l" mode={continuation ? "bezeled" : "filled"} stretched onClick={onExtra}>{extraLabel}</Button>}
          <Button size="l" mode={continuation || showExtra ? "bezeled" : "filled"} stretched onClick={onLearning}>Открыть «Учу»</Button>
          <div className="row result-links">
            {done > 0 && me?.boss && <Button mode="plain" size="m" onClick={onBoss}>К боссу</Button>}
            {notice ? <Button mode="plain" size="m" onClick={onSettings}>Настройки лимитов</Button>
              : <Button mode="plain" size="m" onClick={() => onSets()}>Наборы слов</Button>}
          </div>
          {!notice && <LessonButton />}
        </div>
      }
    />
  );
}
