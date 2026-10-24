import { Button, Cell, List, Placeholder, Progress, Section, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { decideSetItem, getSetItems, getSets, type SetItem, type WordSetInfo } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { DeckCard, type DeckAction } from "./Deck";
import { haptic, notify, useBackButton } from "./telegram";

const UNDO_DEPTH = 5;

/**
 * 📦 Готовые наборы: по уровням и по темам. Набор разбирается колодой — знаю / учу / не для меня;
 * «учу» отправляет слово в личный словарь «Мои слова».
 */
export function Sets({ onExit }: { onExit: () => void }) {
  const [sets, setSets] = useState<WordSetInfo[]>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number>();

  const load = useCallback(() => {
    getSets()
      .then(setSets)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);

  if (open !== undefined) {
    return (
      <SetDeck
        id={open}
        onExit={() => {
          setOpen(undefined);
          load();
        }}
      />
    );
  }
  return <SetList sets={sets} error={error} onOpen={setOpen} onExit={onExit} />;
}

function SetList({ sets, error, onOpen, onExit }: { sets?: WordSetInfo[]; error?: string; onOpen: (id: number) => void; onExit: () => void }) {
  useBackButton(onExit);
  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!sets) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  if (sets.length === 0) return <Placeholder header="Наборов пока нет" description="Скоро появятся 🙂" />;
  const group = (kind: WordSetInfo["kind"]) => sets.filter((s) => s.kind === kind);
  const row = (s: WordSetInfo) => (
    <Cell
      key={s.id}
      multiline
      subtitle={s.description}
      description={
        <span className="set-progress">
          <Progress value={s.total ? (s.done / s.total) * 100 : 0} />
          <span className="hint">
            {s.done} / {s.total}
          </span>
        </span>
      }
      after={s.done >= s.total && s.total > 0 ? "✅" : undefined}
      onClick={() => {
        haptic.tap();
        onOpen(s.id);
      }}
    >
      {s.title}
    </Cell>
  );
  return (
    <List>
      <Text className="hint week-line">Листай слова набора: → знаю, ← учу, ↑ не для меня. Те, что учишь, попадут в «Мои слова» и придут в карточках.</Text>
      <Section header="По уровню">{group("level").map(row)}</Section>
      <Section header="По темам">{group("topic").map(row)}</Section>
    </List>
  );
}

function SetDeck({ id, onExit }: { id: number; onExit: () => void }) {
  const [title, setTitle] = useState("");
  const [deck, setDeck] = useState<SetItem[]>();
  const [error, setError] = useState<string>();
  const [learned, setLearned] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const [history, setHistory] = useState<Array<{ item: SetItem; action: DeckAction; sent: Promise<unknown> }>>([]);
  useBackButton(onExit);

  const load = useCallback(() => {
    getSetItems(id)
      .then((r) => {
        setTitle(r.set.title);
        setRemaining(r.remaining);
        setDeck(r.items);
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [id]);
  useEffect(load, [load]);
  // Порция кончилась, а в наборе ещё есть слова — следующая порция (после того как решения дошли до сервера).
  const empty = deck !== undefined && deck.length === 0 && remaining > 0;
  useEffect(() => {
    if (!empty) return;
    void Promise.all(history.map((h) => h.sent)).then(load);
  }, [empty, history, load]);

  const decide = useCallback((item: SetItem, action: DeckAction) => {
    haptic.tap(action === "learn" ? "medium" : "light");
    const sent = decideSetItem(item, action).catch(() => {});
    if (action === "learn") setLearned((n) => n + 1);
    setHistory((h) => [...h, { item, action, sent }].slice(-UNDO_DEPTH));
    setRemaining((n) => n - 1);
    setDeck((d) => d?.slice(1));
  }, []);

  const undo = useCallback(async () => {
    const last = history.at(-1);
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    try {
      await last.sent;
      await decideSetItem(last.item, last.action, true);
      if (last.action === "learn") setLearned((n) => n - 1);
      setRemaining((n) => n + 1);
      setDeck((d) => [last.item, ...(d ?? [])]);
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  }, [history]);

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!deck) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  const item = deck[0];
  if (!item && remaining > 0) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  return (
    <div className="screen">
      <header className="top">
        <Text weight="2" className="top-title">
          📦 {title}
        </Text>
        <div className="top-right">
          {item && <Text className="hint top-count">осталось {remaining}</Text>}
          {history.length > 0 && (
            <button className="corner-button" aria-label="Отменить последнее решение" onClick={() => void undo()}>
              ↩️
            </button>
          )}
        </div>
      </header>
      {item ? (
        <DeckCard
          key={item.id}
          word={{ ...item, audio: `/api/audio?item=${item.id}` }}
          footer={learned ? `В «Мои слова» сейчас добавлено: ${learned}` : undefined}
          onDecide={(a) => decide(item, a)}
        />
      ) : (
        <SetDone learned={learned} onExit={onExit} />
      )}
    </div>
  );
}

function SetDone({ learned, onExit }: { learned: number; onExit: () => void }) {
  const native = useBottomButtons({ text: "К наборам", onClick: onExit });
  return (
    <Placeholder
      header="Набор разобран 👌"
      description={learned ? `${learned} слов добавлено в «Мои слова» — они придут в карточках.` : "Новых слов для тебя в нём не нашлось."}
      action={native ? undefined : <Button onClick={onExit}>К наборам</Button>}
    />
  );
}
