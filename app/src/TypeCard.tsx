import { AudioButtons } from "./AudioButtons";
import { studyLanguage } from "./language";
import { Button, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { checkAnswer, mediaUrl, saveMistakes, type Answer, type Card, type CheckResult } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { transcription } from "./format";
import { haptic, notify } from "./telegram";

async function play(card: Card, accent: "uk" | "us") {
  const url = await mediaUrl(`/api/audio?card=${card.cardId}&accent=${accent}`);
  if (url) void new Audio(url).play().catch(() => {});
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
 * Задание с ответом текстом: ✍️ вставь по смыслу, 🎧 диктант, ✍️ своё предложение. «Проверить» — нативной кнопкой,
 * проверка и оценка — на сервере; разбор остаётся до «Дальше». onRated — карточка оценена (для ↩️), onRateSelf —
 * проверить не вышло и человек оценил себя сам.
 */
export function TypeCard({ card, onRated, onRateSelf, onNext }: { card: Card; onRated: () => void; onRateSelf: (a: Answer) => void; onNext: () => void }) {
  const [answer, setAnswer] = useState("");
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<CheckResult>();
  const [saved, setSaved] = useState<boolean>();
  const input = useRef<HTMLTextAreaElement>(null);
  const w = card.word;

  // Диктант — сразу озвучить; ввод — сразу в фокусе.
  useEffect(() => {
    if (card.stage === "listen") void play(card, Math.random() < 0.5 ? "uk" : "us");
    input.current?.focus();
  }, [card]);

  const submit = useCallback(
    async (dunno = false) => {
      if (checking || result || (!dunno && !answer.trim())) return;
      setChecking(true);
      try {
        const r = await checkAnswer(card, answer, dunno);
        setResult(r);
        haptic.done(Boolean(r.correct));
        if (!r.unchecked) onRated();
      } catch (err) {
        haptic.done(false);
        notify(err instanceof Error ? err.message : String(err));
      } finally {
        setChecking(false);
      }
    },
    [answer, card, checking, result, onRated],
  );

  const native = useBottomButtons(
    result
      ? result.unchecked
        ? undefined
        : { text: "Дальше", onClick: onNext }
      : checking
        ? undefined
        : { text: "Проверить", onClick: () => void submit() },
    result || checking ? undefined : { text: "🤷 Не знаю", onClick: () => void submit(true) },
  );

  const task =
    card.stage === "cloze" && card.cloze ? (
      <>
        <Text className="hint choice-title">✍️ Вставь пропущенное слово или фразу</Text>
        <Title level="2" weight="2" className="choice-question">
          {result?.filled ? (
            <>
              {result.filled.before}
              <span className={result.correct ? "gap-right" : "gap-answer"}>{result.filled.answer}</span>
              {result.filled.after}
            </>
          ) : (
            card.cloze.sentence
          )}
        </Title>
        <Text className="hint" style={{ textAlign: "center" }}>
          🇷🇺 {card.cloze.translation}
        </Text>
      </>
    ) : card.stage === "listen" ? (
      <>
        <Text className="hint choice-title">🎧 Напиши, что услышал</Text>
        <div className="row">
          <AudioButtons size="m" onPlay={(accent) => void play(card, accent)} />
        </div>
      </>
    ) : (
      <>
        <Text className="hint choice-title">✍️ Составь своё предложение со словом</Text>
        <Title level="2" weight="2" className="choice-question">
          {w.term}
        </Title>
        <Text className="hint" style={{ textAlign: "center" }}>
          {w.translation}
        </Text>
      </>
    );

  return (
    <div className="deck">
      <div className="card choice-card">
        {task}
        {!result && (
          <Textarea
            ref={input}
            className="type-input"
            placeholder={card.stage === "sentence" ? `Твоё предложение ${studyLanguage().adv}` : "Ответ"}
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
        )}
        {checking && (
          <div className="center checking">
            <Spinner size="m" />
            <Text className="hint">{card.stage === "listen" ? "Проверяю…" : "Проверяю — пару секунд…"}</Text>
          </div>
        )}
        {result && <Review card={card} answer={answer} result={result} saved={saved} onSave={setSaved} />}
        {result?.unchecked && (
          <div className="row">
            <Button mode="gray" size="m" onClick={() => (onRateSelf("again"), onNext())}>
              😵 Ошибся
            </Button>
            <Button size="m" onClick={() => (onRateSelf("good"), onNext())}>
              😎 Был прав
            </Button>
          </div>
        )}
      </div>
      {!native && !result && !checking && (
        <div className="actions fixed">
          <div className="row">
            <Button mode="gray" size="l" stretched onClick={() => void submit(true)}>
              🤷 Не знаю
            </Button>
            <Button size="l" stretched onClick={() => void submit()}>
              Проверить
            </Button>
          </div>
        </div>
      )}
      {!native && result && !result.unchecked && (
        <div className="actions fixed">
          <Button size="l" stretched onClick={onNext}>
            Дальше
          </Button>
        </div>
      )}
    </div>
  );
}

function Review({ card, answer, result: r, saved, onSave }: { card: Card; answer: string; result: CheckResult; saved?: boolean; onSave: (s: boolean) => void }) {
  const verdict = r.unchecked
    ? "Не получилось проверить 😔 Сравни сам:"
    : r.grade === "close"
      ? "✅ Почти! Пишется так:"
      : r.correct
        ? card.stage === "sentence"
          ? "✅ Слово употреблено верно"
          : "✅ Верно!"
        : answer
          ? card.stage === "sentence"
            ? "❌ Слово употреблено неверно"
            : "❌ Не то"
          : "🤷 Правильно так:";
  const real = (r.fixes ?? []).filter((f) => !f.slip);
  return (
    <div className="choice-review">
      <Text weight="2">{verdict}</Text>
      {/* В диктанте слово открывается только сейчас; в «своём предложении» оно и так в задании, в пропуске — в предложении. */}
      {card.stage === "listen" && (
        <Text className="block">
          <b>{r.term}</b> — {r.translation}
          {transcription(r) && <span className="hint"> · {transcription(r)}</span>}
        </Text>
      )}
      {card.stage === "listen" && !r.correct && answer && (
        <Text className="hint">
          Ты написал: <s>{answer}</s>
        </Text>
      )}
      {r.explanation && <Text className="block">{r.explanation}</Text>}
      {r.tip && <Text className="block">💡 {r.tip}</Text>}
      {r.verdict && <Text className="block">{r.verdict}</Text>}
      {r.corrected && real.length > 0 && (
        <Text className="block">
          ✍️ <b>Исправлено:</b> <Marked text={r.corrected} />
        </Text>
      )}
      {real.map((f, i) => (
        <Text key={i} className="block">
          • <s>{f.wrong}</s> → <b>{f.right}</b> — {f.why}
        </Text>
      ))}
      {r.natural && (
        <Text className="block">
          💬 <b>Естественнее:</b> {r.natural}
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
              🧠 Сохранить ошибки
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
          <Text className="hint">{saved ? "🧠 Сохранено в работу над ошибками" : "Ошибки не сохранены"}</Text>
        ))}
    </div>
  );
}
