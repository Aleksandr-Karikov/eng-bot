import { Button, Cell, Chip, Input, List, Placeholder, Section, Spinner } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getWords, type WordStatus } from "./api";
import { WordPage } from "./WordPage";
import { AddWord } from "./AddWord";
import { ButtonIcon, IconBox, IconPlus, UsefulDot } from "./icons";
import { haptic, useBackButton } from "./telegram";

const STATUS_LABEL: Record<WordStatus, string> = {
  new: "в очереди",
  learning: "учу",
  known: "знаю",
  hard: "трудное",
  paused: "отложено",
  dropped: "убрано",
};

const FILTERS: Array<{ id: string; label: string; match: (s: WordStatus) => boolean }> = [
  { id: "all", label: "Все", match: (s) => s !== "dropped" },
  { id: "learning", label: "Учу", match: (s) => s === "learning" || s === "hard" },
  { id: "waiting", label: "В очереди", match: (s) => s === "new" || s === "paused" },
  { id: "known", label: "Выучено", match: (s) => s === "known" },
  { id: "hard", label: "Трудные", match: (s) => s === "hard" },
  { id: "dropped", label: "Убранные мной", match: (s) => s === "dropped" },
];

/** Как в боте: регистр и лишние пробелы не важны; ищем и по слову, и по переводу. */
const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** «Назад» со списка — к карточкам. Отдельным компонентом: на странице слова кнопку «Назад» держит она сама. */
function BackToCards({ onExit }: { onExit: () => void }) {
  useBackButton(onExit);
  return null;
}

/** Слова комнаты: поиск, фильтры по моему прогрессу и страница слова по тапу. */
export function Words({ initialFilter, onExit, onSets, onSettings }: {
  initialFilter: "all" | "learning"; onExit: () => void; onSets: () => void; onSettings: () => void;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getWords>>>();
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>(initialFilter);
  const [open, setOpen] = useState<number>();
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await getWords());
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  const shown = useMemo(() => {
    const match = FILTERS.find((f) => f.id === filter)!.match;
    const needle = normalize(query);
    const list = filter === "learning" ? data?.active : data?.words;
    return (list ?? []).filter(
      (w) => match(w.status) && (!needle || normalize(w.term).includes(needle) || normalize(w.translation).includes(needle)),
    );
  }, [data, filter, query]);

  const close = useCallback(() => {
    setOpen(undefined);
    void load();
  }, [load]);

  if (open !== undefined) {
    const status = data?.words.find(({ id }) => id === open)?.status;
    const canTake = data && (status === "new" || status === "paused");
    return <WordPage id={open} status={status} onClose={close} learning={canTake ? {
      active: data.active,
      limit: data.limit,
      onSaved: () => {
        setFilter("learning");
        setQuery("");
        close();
      },
    } : undefined} />;
  }
  if (adding) {
    return (
      <AddWord
        onExit={() => {
          setAdding(false);
          void load();
        }}
      />
    );
  }
  const back = <BackToCards onExit={onExit} />;
  if (error) return <>{back}<Placeholder header="Не получилось загрузить слова" description={error}
    action={<Button onClick={() => { setError(undefined); void load(); }}>Попробовать снова</Button>} /></>;
  if (!data) {
    return (
      <div className="center">
        {back}
        <Spinner size="l" />
      </div>
    );
  }
  if (!data.room) return <>{back}<Placeholder header="Нет комнаты" description="Выбери комнату в настройках или создай в боте: /newroom" /></>;
  const learning = filter === "learning";
  const title = learning ? `Учу · ${data.active.length} из ${data.limit} · все комнаты`
    : filter === "waiting" ? `В очереди · ${data.room} · ${shown.length}` : `${data.room} · ${shown.length}`;

  return (
    <List className="word-list">
      {back}
      {!learning && <div className="form-buttons add-word">
        <Button size="m" stretched onClick={() => setAdding(true)}>
          <ButtonIcon>
            <IconPlus size={18} />
            Добавить слово
          </ButtonIcon>
        </Button>
        <Button size="m" stretched mode="bezeled" onClick={onSets}>
          <ButtonIcon>
            <IconBox size={18} />
            Наборы слов
          </ButtonIcon>
        </Button>
      </div>}
      <div className="chips word-filters" aria-label="Фильтр слов" role="group">
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            Component="button"
            type="button"
            className="word-filter"
            aria-pressed={filter === f.id}
            mode={filter === f.id ? "mono" : "outline"}
            onClick={() => {
              haptic.select();
              setFilter(f.id);
            }}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      <Input aria-label="Поиск слов" placeholder="Найти слово или перевод" value={query} onChange={(e) => setQuery(e.target.value)} />
      <Section header={title}
        footer={learning && data.active.length > data.limit ? "Забытые слова могут остаться в подборке сверх предела." : undefined}>
        {learning && (
          <div className="form-buttons list-actions">
            <Button mode="bezeled" size="m" onClick={() => { haptic.select(); setQuery(""); setFilter("waiting"); }}>Выбрать из очереди</Button>
            <Button mode="plain" size="m" onClick={onSettings}>Настроить лимит</Button>
          </div>
        )}
        {shown.length === 0 && <Cell multiline>{learning && !query.trim() ? "В «Учу» пока нет слов" : "Ничего не нашлось"}</Cell>}
        {shown.map((w) => (
          <Cell
            key={w.id}
            Component="button"
            type="button"
            className="word-list-control"
            subtitle={w.room ? `${w.translation} · ${w.room}` : w.translation}
            after={(!learning || w.status !== "learning") && <span className={`status status-${w.status}`}>{STATUS_LABEL[w.status]}</span>}
            onClick={() => {
              haptic.tap();
              setOpen(w.id);
            }}
          >
            {w.term} <UsefulDot level={w.usefulness} />
          </Cell>
        ))}
      </Section>
    </List>
  );
}
