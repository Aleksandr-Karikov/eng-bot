import { Button, Text, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useState, type ReactNode } from "react";
import type { Quiz } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { haptic } from "./telegram";

/** Сколько видно «✅ Верно» перед следующим заданием, если пояснять нечего. */
const RIGHT_PAUSE_MS = 900;

/**
 * Вопрос с вариантами — 🔗 сочетания или 🧠 вопрос по ошибкам. Ответ — нажатием; верно и без пояснений — дальше само,
 * иначе разбор остаётся на экране до «Дальше» (как в боте). onAnswer может вернуть, что ещё показать в разборе.
 */
export function ChoiceCard({
  title,
  quiz,
  extra,
  quietWhenRight = true,
  onAnswer,
  onNext,
}: {
  title: ReactNode;
  quiz: Quiz;
  /** Что показать в разборе (например, все сочетания слова). */
  extra?: ReactNode;
  /** false — даже верный ответ ждёт «Дальше» (есть что прочитать). */
  quietWhenRight?: boolean;
  onAnswer: (correct: boolean) => Promise<ReactNode | void> | void;
  onNext: () => void;
}) {
  const [chosen, setChosen] = useState<number>();
  const [note, setNote] = useState<ReactNode>();
  const answered = chosen !== undefined;
  const right = chosen === quiz.correct;

  const pick = useCallback(
    async (index: number) => {
      if (chosen !== undefined) return;
      setChosen(index);
      const ok = index === quiz.correct;
      haptic.done(ok);
      const more = await onAnswer(ok);
      if (more) setNote(more);
      if (ok && quietWhenRight && !more) setTimeout(onNext, RIGHT_PAUSE_MS);
    },
    [chosen, quiz.correct, onAnswer, onNext, quietWhenRight],
  );

  // До ответа нижних кнопок нет; после неверного (или когда есть что дочитать) — «Дальше».
  const waiting = answered && (!right || !quietWhenRight || Boolean(note));
  const native = useBottomButtons(waiting ? { text: "Дальше", onClick: onNext } : undefined);

  const [before, after] = splitGap(quiz.question);
  return (
    <div className="deck">
      <div className="card choice-card">
        <Text className="hint choice-title">{title}</Text>
        <Title level="2" weight="2" className="choice-question">
          {answered ? (
            <>
              {quiz.filled.before}
              <span className="gap-right">{quiz.filled.answer}</span>
              {quiz.filled.after}
            </>
          ) : (
            <>
              {before}
              <span className="gap">___</span>
              {after}
            </>
          )}
        </Title>
        <div className="choice-options">
          {quiz.options.map((option, i) => (
            <Button
              key={option + i}
              size="l"
              stretched
              mode={!answered ? "bezeled" : i === quiz.correct ? "filled" : i === chosen ? "gray" : "plain"}
              className={answered && i === chosen && !right ? "option-wrong" : undefined}
              onClick={() => void pick(i)}
            >
              {answered && i === quiz.correct ? `✅ ${option}` : answered && i === chosen ? `❌ ${option}` : option}
            </Button>
          ))}
        </div>
        {answered && (
          <div className="choice-review">
            {quiz.explanation && <Text className="block">{quiz.explanation}</Text>}
            {extra}
            {note}
          </div>
        )}
      </div>
      {waiting && !native && (
        <div className="actions fixed">
          <Button size="l" stretched onClick={onNext}>
            Дальше
          </Button>
        </div>
      )}
    </div>
  );
}

function splitGap(question: string): [string, string] {
  const i = question.indexOf("___");
  return i < 0 ? [question, ""] : [question.slice(0, i), question.slice(i + 3)];
}
