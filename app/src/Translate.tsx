import { Button, Placeholder, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useEffect, useRef, useState } from "react";
import type { AppTranslation } from "../../src/app/translate";
import type { TranslationDirection } from "../../src/llm/tutor";
import { answerAppTranslation, ApiError, getAppTranslation, startAppTranslation } from "./api";
import { LanguageFixes } from "./LanguageFixes";
import { useBackButton } from "./telegram";

const DIRECTIONS = [
  { id: "ru-en", label: "На английский", description: "Русский → английский" },
  { id: "en-ru", label: "На русский", description: "Английский → русский" },
] as const;

export function TranslateScreen({ onExit }: { onExit: () => void }) {
  useBackButton(onExit);
  const [exercise, setExercise] = useState<AppTranslation | null>();
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    getAppTranslation().then((response) => {
      if (active) setExercise(response.exercise);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Не получилось открыть перевод.");
    });
    return () => { active = false; };
  }, []);

  const run = async (request: () => ReturnType<typeof getAppTranslation>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setExercise((await request()).exercise);
      setAnswer("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setExercise(null);
      setError(err instanceof Error ? err.message : "Не получилось продолжить.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  if (exercise === undefined) return error
    ? <Placeholder header="Перевод недоступен" description={error}
      action={<Button onClick={() => void run(getAppTranslation)}>Попробовать снова</Button>} />
    : <div className="center"><Spinner size="l" /></div>;

  const start = (direction: TranslationDirection) => void run(() => startAppTranslation(direction, exercise?.id));
  const lang = exercise?.direction === "en-ru" ? "ru" : "en";
  const result = exercise?.result;
  return (
    <div className="screen preview word-guess">
      <Title Component="h1" level="2" weight="2">Перевод предложений</Title>
      <div className="translate-directions" role="group" aria-label="Направление перевода">
        {DIRECTIONS.map(({ id, label, description }) => (
          <Button size="m" key={id} mode={exercise?.direction === id ? "filled" : "bezeled"}
            aria-label={description} aria-pressed={exercise?.direction === id} disabled={busy}
            onClick={() => { if (exercise?.direction !== id) start(id); }}>
            {label}
          </Button>
        ))}
      </div>
      {error && <Text className="danger" role="alert">{error}</Text>}
      {!exercise ? <Text className="hint" role="status">{busy ? "Готовлю предложение…" : "Выбери направление, чтобы начать."}</Text> : (
        <>
          <section className="word-guess-target" aria-label="Предложение для перевода">
            <Text className="hint">Переведи</Text>
            <Text weight="2" lang={lang === "en" ? "ru" : "en"}>{exercise.source}</Text>
          </section>
          {result ? (
            <div className="word-guess-turn">
              {result.answer && <Text className="word-guess-clue" lang={lang}>{result.answer}</Text>}
              <section className="word-guess-feedback" aria-label="Разбор перевода">
                {result.review && <Text weight="2">{result.review.correct ? "Перевод верный" : "Есть что поправить"}</Text>}
                {result.review?.verdict && <Text className="hint">{result.review.verdict}</Text>}
                <LanguageFixes fixes={result.review?.fixes ?? []} lang={lang} />
                <Text><b>Один из вариантов</b> <span lang={lang}>{result.reference}</span></Text>
                {result.review?.natural && <Text lang={lang}>{result.review.natural}</Text>}
              </section>
              <div className="actions">
                <Button size="l" stretched loading={busy} disabled={busy} onClick={() => start(exercise.direction)}>Следующее предложение</Button>
              </div>
            </div>
          ) : (
            <form className="actions" onSubmit={(event) => {
              event.preventDefault();
              if (answer.trim()) void run(() => answerAppTranslation(exercise.id, answer.trim()));
            }}>
              <Textarea aria-label="Твой перевод" lang={lang} placeholder="Напиши свой перевод"
                value={answer} readOnly={busy} maxLength={600} onChange={(event) => setAnswer(event.target.value)} />
              <Button size="l" stretched type="submit" loading={busy} disabled={busy || !answer.trim()}>Проверить перевод</Button>
              <Button size="m" type="button" mode="plain" disabled={busy}
                onClick={() => void run(() => answerAppTranslation(exercise.id, "", true))}>Показать вариант</Button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
