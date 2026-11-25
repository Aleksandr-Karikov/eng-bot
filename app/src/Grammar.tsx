import { Button, Cell, Input, List, Placeholder, Section, Spinner, Text } from "@telegram-apps/telegram-ui";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getGrammar, getGrammarTopic, sendGrammarAnswer, type GrammarAnswer, type GrammarExercise, type GrammarTopic, type GrammarTopicView } from "./api";
import { haptic, notify, useBackButton } from "./telegram";

/**
 * 📘 Грамматика: темы по уровням → правило → упражнения → экзамен.
 * В шапке — «Aa», а не книга: книга в этом приложении означает словарь («Слова»).
 *
 * Проверка ответа — на сервере сравнением строк, модель не участвует: поэтому здесь нет ни ожидания,
 * ни ошибок «модель не ответила». Приложение не знает правильный ответ до отправки — иначе подсказка
 * была бы видна в исходниках.
 *
 * Три вида упражнений выглядят одинаково: список вариантов. Вид `gap` и `order` тоже приходят вариантами —
 * сервер отдаёт их в `options`, поэтому экран не разбирает типы и не собирает ввод с клавиатуры.
 * Это осознанно: набор с клавиатуры на телефоне проверяется хуже (регистр, лишние пробелы), а сравнение
 * строк должно быть предсказуемым.
 */
export function Grammar({ onExit }: { onExit: () => void }) {
  const [list, setList] = useState<{ topics: GrammarTopic[]; passed: number; total: number }>();
  const [error, setError] = useState<string>();
  const [openId, setOpenId] = useState<number>();
  useBackButton(openId ? () => setOpenId(undefined) : onExit);

  const load = useCallback(() => {
    getGrammar()
      .then(setList)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);

  if (error && !list) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!list) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  if (list.topics.length === 0) {
    // Без технических подробностей: загрузкой контента занимается бот при обновлении, человек тут ни при чём.
    return <Placeholder header="Грамматика готовится" description="Темы появятся в ближайшее обновление. А пока — карточки: они всегда под рукой." />;
  }
  if (openId !== undefined) {
    return <TopicScreen topicId={openId} onBack={() => { setOpenId(undefined); load(); }} />;
  }
  return <TopicList list={list} onOpen={setOpenId} />;
}

function TopicList({ list, onOpen }: { list: { topics: GrammarTopic[]; passed: number; total: number }; onOpen: (id: number) => void }) {
  return (
    <div className="screen">
      <div className="boss-head">
        <Text weight="2">Aa · Грамматика</Text>
        <Text className="hint">
          {list.passed > 0 ? `Сдано: ${list.passed} из ${list.total}` : "Правило, упражнения и экзамен"}
        </Text>
      </div>
      <List>
        <Section>
          {list.topics.map((topic) => (
            <Cell
              key={topic.id}
              onClick={() => onOpen(topic.id)}
              after={<Text className="hint">{topic.passed ? "✅" : topic.done > 0 ? `${topic.done}/${topic.total}` : ""}</Text>}
              subtitle={`${topic.level} · ${topic.total} упражнений`}
            >
              {topic.title}
            </Cell>
          ))}
        </Section>
      </List>
      <Text className="hint" style={{ padding: "0 16px" }}>
        Промах попадает в работу над ошибками и в карточки — как ошибка из /check. Верный ответ бьёт босса.
      </Text>
    </div>
  );
}

/** Тема: правило и примеры сверху, упражнение снизу. После ответа — разбор и следующее. */
function TopicScreen({ topicId, onBack }: { topicId: number; onBack: () => void }) {
  const [view, setView] = useState<GrammarTopicView>();
  const [error, setError] = useState<string>();
  const [answer, setAnswer] = useState<{ exercise: GrammarExercise; picked: string; result: GrammarAnswer }>();
  const [busy, setBusy] = useState(false);
  const reducedMotion = useReducedMotion();

  const load = useCallback(() => {
    getGrammarTopic(topicId)
      .then((r) => setView(r.topic))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [topicId]);
  useEffect(load, [load]);

  if (error && !view) return <Placeholder header="Тема не открылась" description={error} />;
  if (!view) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }

  const next = view.exercises.find((e) => !e.solved) ?? view.exercises[0];
  const current = answer?.exercise ?? next;

  const pick = async (exercise: GrammarExercise, option: string) => {
    if (busy || answer) return;
    setBusy(true);
    try {
      const { result } = await sendGrammarAnswer(exercise.id, option);
      setAnswer({ exercise, picked: option, result });
      haptic.done(result.correct);
      if (!result.correct) notify("Мимо — смотри разбор");
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const goNext = () => {
    setAnswer(undefined);
    load();
  };

  return (
    <div className="screen">
      <div className="boss-head">
        <Text weight="2">{view.title}</Text>
        <Text className="hint">{view.level} · {view.done}/{view.total}{view.passed ? " · сдано" : ""}</Text>
      </div>

      <List>
        <Section header="Правило">
          <Cell multiline>{view.rule}</Cell>
          {view.examples.map((example, i) => (
            <Cell key={i} multiline subtitle="Пример">{example}</Cell>
          ))}
        </Section>
      </List>

      {current && (
        <List>
          <Section header={`Упражнение ${Math.min(view.done + 1, view.total)} из ${view.total}`}>
            <Cell multiline>{current.prompt}</Cell>
            {current.kind === "choice"
              ? (current.options ?? []).map((option) => {
                  const state = !answer
                    ? undefined
                    : option === answer.result.answer
                      ? "right"
                      : option === answer.picked
                        ? "wrong"
                        : "muted";
                  return (
                    <Cell
                      key={option}
                      onClick={() => void pick(current, option)}
                      after={state === "right" ? "✅" : state === "wrong" ? "❌" : undefined}
                      style={state === "muted" ? { opacity: 0.5 } : undefined}
                    >
                      {option}
                    </Cell>
                  );
                })
              : (
                // `gap` и `order` отвечаются вводом: вариантов из ответа больше нет, иначе верный
                // угадывался бы по форме, не зная правила.
                <AnswerInput
                  key={current.id}
                  exercise={current}
                  pending={answer}
                  busy={busy}
                  onSubmit={(text) => void pick(current, text)}
                />
              )}
          </Section>
        </List>
      )}

      {answer && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          style={{ padding: "0 16px", display: "grid", gap: 8 }}
        >
          <Text weight="2">{answer.result.correct ? "✅ Верно" : "❌ Неверно"}</Text>
          {!answer.result.correct && <Text>Правильно: <b>{answer.result.answer}</b></Text>}
          {answer.result.why && <Text className="hint">{answer.result.why}</Text>}
          {answer.result.bossDamage > 0 && <Text className="hint">🐉 Боссу: −{answer.result.bossDamage} HP</Text>}
          <Button size="m" stretched onClick={goNext}>
            {answer.result.passed ? "Тема сдана — к упражнениям" : "▶ Дальше"}
          </Button>
        </motion.div>
      )}

      <div style={{ padding: "0 16px", display: "flex", gap: 8 }}>
        <Button size="m" mode="bezeled" stretched onClick={onBack}>← К темам</Button>
      </div>
      {!current && <Placeholder header="Упражнений нет" description="В этой теме пока нет заданий — загляни позже." />}
    </div>
  );
}

/**
 * Ответ на `gap` и `order` — вводом, а не кнопками.
 *
 * Почему так: варианты, собранные на сервере из правильного ответа, были неязыковыми
 * («works | worksing | workss») — верный угадывался по форме, без знания правила. Здесь человек пишет
 * форму сам, поэтому упражнение тренирует вспоминание.
 *
 * У сборки предложения слова даны кнопками: на телефоне набрать целую фразу медленнее и легче ошибиться
 * в регистре, а тренируется порядок слов, а не скорость печати. Набранное руками тоже принимается.
 */
function AnswerInput({ exercise, pending, busy, onSubmit }: {
  exercise: GrammarExercise;
  pending?: { picked: string; result: GrammarAnswer };
  busy: boolean;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState(pending?.picked ?? "");
  const input = useRef<HTMLInputElement>(null);
  // Слова, уже поставленные в предложение: второй раз то же слово не подставить, если оно одно в наборе.
  const [taken, setTaken] = useState<number[]>([]);
  const words = exercise.words ?? [];
  const answer = pending?.result;

  // После разбора поле блокируется: ответ уже дан, и правки в нём ничего не изменят.
  const locked = Boolean(answer) || busy;

  useEffect(() => {
    if (exercise.kind === "gap" && !answer) input.current?.focus();
  }, [exercise.id, exercise.kind, answer]);

  const append = (word: string, index: number) => {
    if (locked) return;
    setText((current) => {
      const next = current.trim() ? `${current.trim()} ${word}` : word;
      return next;
    });
    setTaken((current) => [...current, index]);
    haptic.tap();
  };

  return (
    <div style={{ padding: 16, display: "grid", gap: 12 }}>
      {exercise.kind === "order" && words.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {words.map((word, index) => (
            <Button
              key={`${word}-${index}`}
              size="s"
              mode={taken.includes(index) ? "plain" : "filled"}
              disabled={locked || taken.includes(index)}
              onClick={() => append(word, index)}
            >
              {word}
            </Button>
          ))}
        </div>
      )}

      <Input
        ref={input}
        placeholder={exercise.kind === "order" ? "Собери предложение" : "Впиши ответ"}
        value={text}
        disabled={locked}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          if (!text.trim()) return;
          onSubmit(text.trim());
        }}
      />
      {exercise.kind === "order" && (
        <Text className="hint">Слова перемешаны — нажимай по порядку. Можно и напечатать.</Text>
      )}
    </div>
  );
}
