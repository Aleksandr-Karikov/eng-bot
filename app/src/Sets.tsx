import { Button, Cell, List, Placeholder, Progress, Section, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { decideSetItem, getSetItems, getSets, setSetTarget, type SetItem, type SetTargetState, type WordSetInfo } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { DeckCard, type DeckAction } from "./Deck";
import { IconUndo } from "./icons";
import { haptic, notify, useBackButton } from "./telegram";

const UNDO_DEPTH = 5;

/**
 * Готовые наборы: по уровням и по темам. Набор разбирается колодой — знаю / учу / не для меня.
 *
 * «Учу» кладёт слово в комнату, которую человек выбрал (`SetTargetState`): по умолчанию текущую,
 * а не всегда в личный словарь. Иначе слова, которые учат в общей комнате, не попадали в её босса —
 * урон считался цели личной комнаты, где человек один, и выглядел как «не засчитывается».
 *
 * `startSetId` открывает набор сразу, минуя список: так пустой `/learn` ведёт новичка в A1 одним
 * тапом. Список ему сейчас не нужен — он ещё не знает, чем A1 отличается от B2.
 */
export function Sets({ onExit, startSetId }: { onExit: () => void; startSetId?: number }) {
  const [sets, setSets] = useState<WordSetInfo[]>();
  const [target, setTarget] = useState<SetTargetState>();
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState<number | undefined>(startSetId);

  const load = useCallback(() => {
    getSets()
      .then((r) => {
        setSets(r.sets);
        setTarget({ target: r.target, rooms: r.rooms, needsChoice: r.needsChoice });
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);
  useEffect(load, [load]);

  const choose = useCallback(async (roomId: number) => {
    setTarget(await setSetTarget(roomId));
  }, []);

  if (open !== undefined) {
    return (
      <SetDeck
        id={open}
        target={target}
        onChooseRoom={choose}
        onExit={() => {
          setOpen(undefined);
          load();
        }}
      />
    );
  }
  return <SetList sets={sets} target={target} error={error} onOpen={setOpen} onExit={onExit} onChooseRoom={choose} />;
}

function SetList({ sets, target, error, onOpen, onExit, onChooseRoom }: {
  sets?: WordSetInfo[];
  target?: SetTargetState;
  error?: string;
  onOpen: (id: number) => void;
  onExit: () => void;
  onChooseRoom: (roomId: number) => Promise<void>;
}) {
  useBackButton(onExit);
  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!sets) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  if (sets.length === 0) return <Placeholder header="Наборов пока нет" description="Скоро появятся" />;
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
      after={s.done >= s.total && s.total > 0 ? "✓" : undefined}
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
      <Text className="hint week-line">Листай слова набора: → знаю, ← учу, ↑ не для меня. Те, что учишь, придут в карточках.</Text>
      {target && (
        <Section header="Куда попадут слова, которые учишь" footer={target.needsChoice ? "Выбери комнату — от неё зависит, в чей босс пойдёт урон." : undefined}>
          {target.rooms.map((r) => (
            <Cell
              key={r.roomId}
              after={r.roomId === target.target.roomId ? "✓" : undefined}
              subtitle={r.personal ? "личный словарь: видишь только ты" : undefined}
              onClick={() => {
                if (r.roomId === target.target.roomId) return;
                haptic.select();
                void onChooseRoom(r.roomId);
              }}
            >
              {r.roomName}
            </Cell>
          ))}
        </Section>
      )}
      <Section header="По уровню">{group("level").map(row)}</Section>
      <Section header="По темам">{group("topic").map(row)}</Section>
    </List>
  );
}

function SetDeck({ id, target, onChooseRoom, onExit }: {
  id: number;
  target?: SetTargetState;
  onChooseRoom: (roomId: number) => Promise<void>;
  onExit: () => void;
}) {
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
          {title}
        </Text>
        <div className="top-right">
          {item && <Text className="hint top-count">осталось {remaining}</Text>}
          {history.length > 0 && (
            <button className="corner-button" aria-label="Отменить последнее решение" onClick={() => void undo()}>
              <IconUndo size={18} />
            </button>
          )}
        </div>
      </header>
      {item && target?.needsChoice && (
        <Section header="Куда добавлять слова, которые учишь" footer="От комнаты зависит, в чей босс пойдёт урон за эти слова. Спросим один раз.">
          {target.rooms.map((r) => (
            <Cell
              key={r.roomId}
              after={r.roomId === target.target.roomId ? "✓" : undefined}
              subtitle={r.personal ? "личный словарь: видишь только ты" : undefined}
              onClick={() => {
                if (r.roomId === target.target.roomId) return;
                haptic.select();
                void onChooseRoom(r.roomId);
              }}
            >
              {r.roomName}
            </Cell>
          ))}
        </Section>
      )}
      {item ? (
        <DeckCard
          key={item.id}
          word={{ ...item, audio: `/api/audio?item=${item.id}` }}
          footer={
            learned
              ? `Добавлено в «${target?.target.roomName ?? "Мои слова"}»: ${learned}`
              : target
                ? `«Учу» добавит в «${target.target.roomName}»${target.target.personal ? " (личный словарь)" : ""}`
                : undefined
          }
          onDecide={(a) => decide(item, a)}
        />
      ) : (
        <SetDone learned={learned} roomName={target?.target.roomName} onExit={onExit} />
      )}
    </div>
  );
}

function SetDone({ learned, roomName, onExit }: { learned: number; roomName?: string; onExit: () => void }) {
  const native = useBottomButtons({ text: "К наборам", onClick: onExit });
  return (
    <Placeholder
      header="Набор разобран"
      description={learned ? `${learned} слов добавлено в «${roomName ?? "Мои слова"}» — они придут в карточках.` : "Новых слов для тебя в нём не нашлось."}
      action={native ? undefined : <Button onClick={onExit}>К наборам</Button>}
    />
  );
}
