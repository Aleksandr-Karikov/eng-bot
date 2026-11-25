import { Button, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useEffect, useRef, useState } from "react";
import { ApiError, answerDialogue, openDialogue, type Card, type CheckResult, type DialogueScene, type DialogueTurn } from "./api";
import { haptic } from "./telegram";
import { ExerciseReview } from "./TypeCard";
import { useTypeKeyboard } from "./useTypeKeyboard";

export function DialogueCard({ card, onRated, onNext, onFallback }: {
  card: Card;
  onRated: (damage: number) => void;
  onNext: () => void;
  onFallback: () => void;
}) {
  const [scene, setScene] = useState<DialogueScene>();
  const [reload, setReload] = useState(0);
  const [error, setError] = useState<{ text: string; stale?: boolean }>();
  const [hint, setHint] = useState(false);
  const [answer, setAnswer] = useState("");
  const [retry, setRetry] = useState<string>();
  const [checking, setChecking] = useState(false);
  const [firstAnswer, setFirstAnswer] = useState("");
  const [followUp, setFollowUp] = useState<DialogueTurn>();
  const [bonus, setBonus] = useState(false);
  const [result, setResult] = useState<CheckResult>();
  const [saved, setSaved] = useState<boolean>();
  const active = useRef(false);
  const { deck, input, keyboardOpen } = useTypeKeyboard(Boolean(scene && !result));

  useEffect(() => {
    active.current = true;
    let current = true;
    void openDialogue(card).then((data) => {
      if (current) setScene(data);
    }).catch((err: unknown) => {
      if (!current) return;
      const stale = err instanceof ApiError && (err.status === 409 || err.status === 404);
      setError({ text: err instanceof Error ? err.message : "Не получилось подготовить диалог", stale });
    });
    return () => {
      current = false;
      active.current = false;
    };
  }, [card, reload]);

  async function submit(dunno = false) {
    if (!scene || checking || result || (!dunno && !answer.trim())) return;
    setChecking(true);
    setError(undefined);
    try {
      const response = await answerDialogue(scene.id, bonus ? 2 : 1, dunno ? "" : answer, dunno);
      if (!active.current) return;
      if ("retry" in response) {
        setRetry(response.verdict || "Попробуй ещё раз со словом из задания.");
        return;
      }
      setRetry(undefined);
      setResult(response);
      haptic.done(Boolean(response.correct));
      if (!bonus) {
        setFirstAnswer(dunno ? "" : answer.trim());
        setFollowUp(response.followUp);
        onRated(response.damage);
      }
    } catch (err) {
      if (!active.current) return;
      if (!bonus && err instanceof ApiError && (err.status === 409 || err.status === 404)) return onNext();
      setError({ text: err instanceof Error ? err.message : "Не получилось проверить ответ" });
    } finally {
      if (active.current) setChecking(false);
    }
  }

  function continueDialogue() {
    setBonus(true);
    setHint(false);
    setAnswer("");
    setResult(undefined);
    setSaved(undefined);
  }

  const turn = bonus ? followUp : scene;
  return (
    <div ref={deck} className={`deck type-deck${keyboardOpen ? " keyboard-open" : ""}`}>
      <section className="card choice-card type-card dialogue-card" aria-labelledby="dialogue-title">
        <Title level="3" weight="2" id="dialogue-title">Ответь собеседнику</Title>
        {scene && turn ? (
          <>
            <div className="type-prompt">
              <Text className="hint dialogue-situation">{scene.situation}</Text>
              <div className="dialogue-thread">
                <Reply line={scene.line} />
                {firstAnswer && <Reply line={firstAnswer} own />}
                {bonus && <Reply line={turn.line} />}
                {bonus && result && <Reply line={answer.trim()} own />}
              </div>
              {!result && <Text>Употреби <b lang="en">{card.word.term}</b> в ответе</Text>}
              {!result && hint && (
                <>
                  {!bonus && <Text className="hint">Смысл слова: {card.word.translation}</Text>}
                  {turn.hint && <Text className="hint">Начало ответа: <span lang="en">{turn.hint}</span></Text>}
                </>
              )}
            </div>
            {result ? (
              <ExerciseReview card={card} answer={bonus ? answer : firstAnswer} result={result} saved={saved} onSave={setSaved} />
            ) : (
              <>
                {retry && <Text role="status">{retry}</Text>}
                <div className="type-field">
                  <Textarea
                    ref={input}
                    aria-label="Твой ответ"
                    className="type-input"
                    lang="en"
                    placeholder="Твоя реплика на английском"
                    disabled={checking}
                    value={answer}
                    maxLength={500}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
                      e.preventDefault();
                      void submit();
                    }}
                  />
                </div>
                {!hint && !checking && (!bonus || turn.hint) && <Button mode="plain" size="s" onClick={() => setHint(true)}>Подсказка</Button>}
              </>
            )}
            {error && <Text role="alert">{error.text}</Text>}
            {checking ? (
              <div className="checking" role="status"><Spinner size="m" /><Text>Проверяю ответ…</Text></div>
            ) : (
              <div className="actions">
                {!result && <Button size="l" stretched disabled={!answer.trim()} onClick={() => void submit()}>Ответить</Button>}
                {result && !bonus && followUp && <Button size="l" mode="bezeled" stretched onClick={continueDialogue}>Продолжить диалог</Button>}
                {(result || bonus) && <Button size="l" stretched onClick={onNext}>Дальше</Button>}
                {!result && !bonus && (error
                  ? <Button size="m" mode="plain" stretched onClick={onFallback}>Обычная карточка</Button>
                  : <Button size="m" mode="plain" stretched onClick={() => void submit(true)}>Не знаю</Button>)}
              </div>
            )}
          </>
        ) : error ? (
          <>
            <Text role="alert">{error.text}</Text>
            <div className="actions">
              {error.stale ? <Button size="l" stretched onClick={onNext}>Дальше</Button> : (
                <>
                  <Button size="l" stretched onClick={onFallback}>Обычная карточка</Button>
                  <Button size="m" mode="plain" stretched onClick={() => { setError(undefined); setReload((n) => n + 1); }}>Повторить</Button>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="checking" role="status"><Spinner size="m" /><Text>Готовлю диалог…</Text></div>
            <Button size="m" mode="plain" onClick={onFallback}>Обычная карточка</Button>
          </>
        )}
      </section>
    </div>
  );
}

function Reply({ line, own }: { line: string; own?: boolean }) {
  return (
    <div className={`dialogue-reply${own ? " dialogue-own" : ""}`}>
      <Text className="hint" weight="2">{own ? "Ты" : "Собеседник"}</Text>
      <Text className="block" lang="en">{line}</Text>
    </div>
  );
}
