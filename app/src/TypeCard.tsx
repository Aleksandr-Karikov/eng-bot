import { cardAudioPath, playAudio } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { useTypeKeyboard } from "./useTypeKeyboard";
import { Button, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, checkAnswer, saveMistakes, type Answer, type Card, type CheckResult, type VoiceAccent } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { transcription } from "./format";
import { haptic, notify } from "./telegram";
import { gapCount, gapSegments } from "./gaps";

function play(card: Card, accent: "uk" | "us") {
  playAudio(cardAudioPath(card.cardId, accent));
}

/** «**слово**» из разбора /check — жирным. */
function Marked({ text }: { text: string }) {
  return (
    <>
      {text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part))}
    </>
  );
}

/**
 * Задание с ответом текстом: пропуск по смыслу и диктант. «Проверить» — нативной кнопкой,
 * проверка и оценка — на сервере; разбор остаётся до «Дальше». onRated — карточка оценена (для отмены), onRateSelf —
 * проверить не вышло и человек оценил себя сам.
 */
export function TypeCard({ card, voice, onRated, onRateSelf, onNext }: { card: Card; voice?: VoiceAccent | null; onRated: (damage: number) => void; onRateSelf: (a: Answer) => void; onNext: () => void }) {
  const [answer, setAnswer] = useState("");
  // Задание с несколькими пропусками (баг #25): по ответу на каждый, заполнять можно в любом порядке
  // — человек тапает по нужному пропуску, и фокус уходит туда.
  const gaps = card.stage === "cloze" && card.cloze ? gapCount(card.cloze.sentence) : 1;
  const [answers, setAnswers] = useState<string[]>(() => Array<string>(Math.max(1, gaps)).fill(""));
  const fields = useRef<Array<HTMLInputElement | null>>([]);
  /** Куда поставить фокус: пропуск, который человек выбрал сам, иначе первый. */
  const [focusAt, setFocusAt] = useState(0);
  useEffect(() => {
    setAnswers(Array(Math.max(1, gaps)).fill(""));
    setFocusAt(0);
  }, [card.cardId, gaps]);
  useEffect(() => {
    if (gaps > 1) fields.current[focusAt]?.focus();
  }, [focusAt, gaps]);
  /** Ответ для сервера: несколько пропусков — через `|`, как хранится в базе. */
  const answerText = gaps > 1 ? answers.map((a) => a.trim()).join("|") : answer;
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult>();
  const [saved, setSaved] = useState<boolean>();
  const { input, deck, keyboardOpen } = useTypeKeyboard();

  useEffect(() => {
    // Диктант читает выбранным вариантом произношения — тем же, что и карточка. Раньше здесь
    // стоял случайный выбор, из-за чего включённый американский звучал британским через слово:
    // человек выбирал вариант в настройках, а диктант его игнорировал.
    // Случайный выбор остаётся только запасным — когда озвучка не выбрана вовсе, но диктант
    // без звука невозможен: тогда любой вариант лучше молчания.
    if (card.stage === "listen") void play(card, voice ?? (Math.random() < 0.5 ? "uk" : "us"));
  }, [card, voice]);

  const submit = useCallback(
    async (dunno = false) => {
      if (checking || result) return;
      if (!dunno && (gaps > 1 ? answers.some((a) => !a.trim()) : !answer.trim())) return;
      setChecking(true);
      try {
        const r = await checkAnswer(card, answerText, dunno);
        setResult(r);
        haptic.done(Boolean(r.correct));
        if (!r.unchecked) onRated(r.damage);
      } catch (err) {
        haptic.done(false);
        // Карточка успела измениться или уйти в очередь, пока был открыт диктант.
        if (err instanceof ApiError && err.status === 409) {
          notify(err.message);
          return onNext();
        }
        notify(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [answerText, answers, answer, gaps, card, checking, result, onRated, onNext],
  );

  const native = useBottomButtons(
    keyboardOpen ? undefined : result
      ? result.unchecked
        ? undefined
        : { text: "Дальше", onClick: onNext }
      : checking
        ? undefined
        : { text: "Проверить", onClick: () => void submit() },
    keyboardOpen || result || checking ? undefined : { text: "Не знаю", onClick: () => void submit(true) },
  );

  const task =
    card.stage === "cloze" && card.cloze ? (
      <>
        <Text className="hint choice-title">
          {gaps > 1 ? `Заполни ${gaps} пропуска` : "Вставь пропущенное слово или фразу"}
        </Text>
        {result?.filled ? (
          <Title level="2" weight="2" className="choice-question">
            {/* После ответа — всё предложение с подставленными ответами; неверный выделен. */}
            {result.filled.parts?.length ? (
              result.filled.parts.map((p, i) =>
                "text" in p ? (
                  <span key={i}>{p.text}</span>
                ) : (
                  <span key={i} className={result.correct ? "gap-right" : "gap-answer"}>{p.answer}</span>
                ),
              )
            ) : (
              <>
                {result.filled.before}
                <span className={result.correct ? "gap-right" : "gap-answer"}>{result.filled.answer}</span>
                {result.filled.after}
              </>
            )}
          </Title>
        ) : gaps > 1 ? (
          // Поля стоят в самом предложении: человек видит, какой пропуск заполняет. Тап по любому
          // переводит фокус туда, поэтому порядок заполнения свободный.
          <div className="cloze-gaps">
            {gapSegments(card.cloze.sentence).map((text, i, all) => (
              <span key={i}>
                {text}
                {i < all.length - 1 && (
                  <input
                    ref={(el) => { fields.current[i] = el; }}
                    className="gap-input"
                    aria-label={`Пропуск ${i + 1}`}
                    value={answers[i] ?? ""}
                    disabled={checking}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                    onFocus={() => setFocusAt(i)}
                    onKeyDown={(e) => {
                      // Enter — дальше или проверить: заполняют по очереди, и так быстрее.
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      if (i < all.length - 2) setFocusAt(i + 1);
                      else void submit();
                    }}
                  />
                )}
              </span>
            ))}
          </div>
        ) : (
          <Title level="2" weight="2" className="choice-question">
            {card.cloze.sentence}
          </Title>
        )}
        <Text className="hint" style={{ textAlign: "center" }}>
          {card.cloze.translation}
        </Text>
      </>
    ) : (
      <>
        <Text className="hint choice-title">Напиши, что услышал</Text>
        <div className="row">
          <AudioButtons size="m" onPlay={(accent) => void play(card, accent)} />
        </div>
      </>
    );

  return (
    <div ref={deck} className={`deck type-deck${keyboardOpen ? " keyboard-open" : ""}`}>
      <div className={`card choice-card type-card${result ? " type-card-reviewed" : ""}`}>
        <div className="type-prompt">{task}</div>
        {/* При двух пропусках поля стоят внутри предложения — отдельное поле не нужно. */}
        {!result && gaps <= 1 && (
          <div className="type-field">
            <Textarea
              ref={input}
              aria-label="Ответ"
              className="type-input"
              placeholder="Ответ"
              value={answer}
              disabled={checking}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                // Enter — проверить (в предложении Shift+Enter — новая строка).
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
        )}
        {checking && (
          <div className="checking">
            <Spinner size="m" />
            <Text className="hint">{card.stage === "listen" ? "Проверяю…" : "Проверяю — пару секунд…"}</Text>
          </div>
        )}
        {result && <ExerciseReview card={card} answer={answer} result={result} saved={saved} onSave={setSaved} />}
        {result?.unchecked && (
          <div className="row">
            <Button mode="gray" size="m" onClick={() => (onRateSelf("again"), onNext())}>
              Ошибся
            </Button>
            <Button size="m" onClick={() => (onRateSelf("good"), onNext())}>
              Был прав
            </Button>
          </div>
        )}
      </div>
      {(!native || keyboardOpen) && !result && !checking && (
        <div className="actions fixed">
          <div className="row">
            <Button mode="gray" size={keyboardOpen ? "m" : "l"} stretched onClick={() => void submit(true)}>
              Не знаю
            </Button>
            <Button size={keyboardOpen ? "m" : "l"} stretched onClick={() => void submit()}>
              Проверить
            </Button>
          </div>
        </div>
      )}
      {(!native || keyboardOpen) && result && !result.unchecked && (
        <div className="actions fixed">
          <Button size="l" stretched onClick={onNext}>
            Дальше
          </Button>
        </div>
      )}
    </div>
  );
}

export function ExerciseReview({ card, answer, result: r, saved, onSave }: { card: Card; answer: string; result: CheckResult; saved?: boolean; onSave: (s: boolean) => void }) {
  const verdict = r.unchecked
    ? "Не получилось проверить. Сравни сам:"
    : r.grade === "close"
      ? "Почти! Пишется так:"
      : r.correct
        ? card.stage === "sentence"
          ? "Слово употреблено верно"
          : "Верно!"
        : answer
          ? card.stage === "sentence"
            ? "Ответ по карточке не засчитан"
            : "Не то"
          : "Правильно так:";
  const real = (r.fixes ?? []).filter((f) => !f.slip);
  return (
    <div className="choice-review">
      <Text weight="2">{verdict}</Text>
      {(card.stage === "listen" || card.stage === "sentence") && (
        <Text className="block">
          <b lang="en">{r.term}</b> — {r.translation}
          {transcription(r) && <span className="hint"> · {transcription(r)}</span>}
        </Text>
      )}
      {card.stage === "listen" && !r.correct && answer && (
        <Text className="hint">
          Ты написал: <s>{answer}</s>
        </Text>
      )}
      {r.explanation && <Text className="block">{r.explanation}</Text>}
      {r.tip && <Text className="block">Подсказка: {r.tip}</Text>}
      {r.verdict && <Text className="block">{r.verdict}</Text>}
      {r.corrected && real.length > 0 && (
        <Text className="block">
          <b>Исправлено:</b> <Marked text={r.corrected} />
        </Text>
      )}
      {real.map((f, i) => (
        <Text key={i} className="block">
          • <s>{f.wrong}</s> → <b>{f.right}</b> — {f.why}
        </Text>
      ))}
      {r.natural && (
        <Text className="block">
          <b>{card.stage === "sentence" && !r.correct ? "В этой ситуации" : "Естественнее"}:</b> {r.natural}
        </Text>
      )}
      {(card.stage === "sentence" || !r.correct) && r.example && (
        <Text className="block">
          Пример: <i>{r.example}</i>
        </Text>
      )}
      {r.mistakesId !== undefined &&
        (saved === undefined ? (
          <div className="actions">
            <Button
              size="m"
              stretched
              mode="bezeled"
              onClick={() => {
                onSave(true);
                void saveMistakes(r.mistakesId!, true).catch(() => {});
              }}
            >
              Сохранить ошибки
            </Button>
            <Button
              size="m"
              stretched
              mode="plain"
              onClick={() => {
                onSave(false);
                void saveMistakes(r.mistakesId!, false).catch(() => {});
              }}
            >
              Не сохранять
            </Button>
          </div>
        ) : (
          <Text className="hint">{saved ? "Сохранено в работу над ошибками" : "Ошибки не сохранены"}</Text>
        ))}
    </div>
  );
}
