import { Button, Cell, List, Placeholder, Section, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WordGuessResult, WordGuessRound } from "../../src/app/word-guess";
import { ApiError, moveWordGuess, openWordGuess } from "./api";
import { useBackButton } from "./telegram";

function attemptLabel(attempts: number | null): string {
  if (attempts === null) return "Не угадано";
  return attempts === 1 ? "С первой подсказки" : `С ${attempts}-й подсказки`;
}

function ResultLine({ result }: { result: WordGuessResult }) {
  const previous = result.previousAttempts;
  return (
    <>
      <Text weight="2">{attemptLabel(result.attempts)}</Text>
      {previous !== undefined && previous !== result.attempts && (
        <Text className="hint">В прошлый раз · {attemptLabel(previous).toLowerCase()}</Text>
      )}
      {result.phrase && <Text lang="en" className="word-guess-phrase">{result.phrase}</Text>}
    </>
  );
}

export function WordGuessScreen({ onExit }: { onExit: () => void }) {
  useBackButton(onExit);
  const [round, setRound] = useState<WordGuessRound | null>();
  const [clue, setClue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const run = useCallback(async (request: () => ReturnType<typeof openWordGuess>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      setRound((await request()).round);
      setClue("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 410) setRound(undefined);
      setError(err instanceof Error ? err.message : "Не получилось сделать ход.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    openWordGuess().then(({ round: initial }) => {
      if (active) setRound(initial);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Не получилось открыть раунд.");
    });
    return () => { active = false; };
  }, []);

  if (round === undefined) return error ? (
    <Placeholder header="Раунд недоступен" description={error}
      action={<Button onClick={() => void run(openWordGuess)}>Попробовать снова</Button>} />
  ) : <div className="center"><Spinner size="l" /></div>;
  if (round === null) return (
    <Placeholder header="Пока нечего объяснять" description="Добавь слово в словарь, чтобы начать игру."
      action={<Button onClick={onExit}>К карточкам</Button>} />
  );

  const { current, results, total, attemptLimit } = round;
  const move = (action: "clue" | "skip" | "next") =>
    void run(() => moveWordGuess(round, action, action === "clue" ? clue.trim() : undefined));
  const errorNotice = error && <Text className="danger" role="alert">{error}</Text>;

  return (
    <div className="screen preview word-guess">
      <header className="top">
        <Title Component="h1" level="2" weight="2">Объясни слово</Title>
        {current && <Text className="hint top-count">{results.length + (current.result ? 0 : 1)} из {total}</Text>}
      </header>
      {current ? (
        <>
          <section className="word-guess-target" aria-label="Загаданное слово">
            <Title level="1" weight="2" lang="en">{current.term}</Title>
            <Text className="hint">{current.translation}</Text>
          </section>
          {current.turns.length > 0 && (
            <div className="word-guess-dialogue" aria-label="Диалог" aria-live="polite">
              {current.turns.map(({ clue, guess, question }, index) => (
                <div className="word-guess-turn" key={index}>
                  <Text className="word-guess-clue" lang="en">{clue}</Text>
                  {(guess || question) && <div className="word-guess-reply">
                    {guess && <Text><b>Догадка ИИ</b> <span lang="en">{guess}</span></Text>}
                    {question && <Text lang="en">{question}</Text>}
                  </div>}
                </div>
              ))}
            </div>
          )}
          {current.result ? (
            <div className="actions">
              <ResultLine result={current.result} />
              {errorNotice}
              <Button size="l" stretched loading={busy} disabled={busy} onClick={() => move("next")}>
                {results.length === total ? "Смотреть итог" : "Следующее слово"}
              </Button>
            </div>
          ) : (
            <form className="actions" onSubmit={(event) => {
              event.preventDefault();
              if (clue.trim()) move("clue");
            }}>
              <Text className="hint">{current.turns.length === 0
                ? "Опиши слово по-английски, не называя его."
                : `Уточнений осталось · ${attemptLimit - current.turns.length}`}</Text>
              <Textarea aria-label="Подсказка по-английски" lang="en" placeholder={current.turns.length ? "Уточни подсказку" : "It’s something you…"}
                value={clue} maxLength={400} readOnly={busy} onChange={(event) => setClue(event.target.value)} />
              {errorNotice}
              <Button type="submit" size="l" stretched loading={busy} disabled={busy || !clue.trim()}>Отправить подсказку</Button>
              <Button type="button" size="m" mode="plain" disabled={busy} onClick={() => move("skip")}>Пропустить</Button>
            </form>
          )}
        </>
      ) : (
        <>
          <Title level="2" weight="2">Угадано {results.filter(({ attempts }) => attempts !== null).length} из {total}</Title>
          <Text className="hint">С первой подсказки · {results.filter(({ attempts }) => attempts === 1).length}</Text>
          <List>
            <Section>
              {results.map((result) => <Cell multiline key={result.term}>
                <div className="word-guess-turn">
                  <Text weight="2" lang="en">{result.term}</Text>
                  <ResultLine result={result} />
                </div>
              </Cell>)}
            </Section>
          </List>
          {errorNotice}
          <div className="actions">
            <Button size="l" stretched loading={busy} disabled={busy} onClick={() => void run(() => openWordGuess(true))}>Новый раунд</Button>
          </div>
        </>
      )}
    </div>
  );
}
