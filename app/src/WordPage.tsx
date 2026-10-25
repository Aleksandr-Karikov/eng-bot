import { playAudio } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { Button, Cell, Input, List, Placeholder, Section, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { editWord, getWord, newMnemonic, wordAction, wordPictureUrl, type WordAction, type WordDetails } from "./api";
import { transcription, USEFULNESS } from "./format";
import { confirmDanger, haptic, notify, useBackButton } from "./telegram";

function play(id: number, accent: "uk" | "us") {
  playAudio(`/api/audio?word=${id}&accent=${accent}`);
}

/** Страница слова: всё, что есть на карточке, и действия «⚙️ Управление словом» из бота. */
export function WordPage({ id, onClose }: { id: number; onClose: () => void }) {
  const [word, setWord] = useState<WordDetails>();
  const [error, setError] = useState<string>();
  const [picture, setPicture] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  // Одна кнопка «Назад» на экран: из правки — к слову, со слова — к списку.
  const back = useCallback(() => (editing ? setEditing(false) : onClose()), [editing, onClose]);
  useBackButton(back);

  const load = useCallback(async () => {
    try {
      const w = await getWord(id);
      setWord(w);
      if (w.hasPicture) void wordPictureUrl(w.id).then(setPicture);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [id]);
  useEffect(() => void load(), [load]);

  const act = async (action: WordAction) => {
    if (!word || busy) return;
    if (action === "delete") {
      const sure = await confirmDanger(`Удалить «${word.term}» у всех? Карточки и прогресс по нему пропадут у всех участников.`, "Удалить");
      if (!sure) return;
    }
    setBusy(true);
    try {
      await wordAction(word.id, action);
      haptic.done(true);
      if (action === "delete") return onClose();
      await load();
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <Placeholder header="Не получилось открыть слово" description={error} action={<Button onClick={onClose}>Назад</Button>} />;
  if (!word) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  if (editing) {
    return (
      <EditForm
        word={word}
        onDone={(saved) => {
          setEditing(false);
          if (saved) void load();
        }}
      />
    );
  }

  const contexts = [...word.moreContexts.map((c) => c.text), word.context].filter(Boolean);
  return (
    <List>
      <div className="word-head">
        <Title level="1" weight="2">
          {word.term} {word.usefulness ? USEFULNESS[word.usefulness] : ""}
        </Title>
        {transcription(word) && <Text className="hint">{transcription(word)}</Text>}
        <Title level="2" weight="2" className="answer">
          {word.translation}
        </Title>
        <div className="row">
          <AudioButtons size="s" onPlay={(accent) => void play(word.id, accent)} />
        </div>
      </div>

      {word.explanation && (
        <Section header="Объяснение">
          <Cell multiline>{word.explanation}</Cell>
        </Section>
      )}
      {word.example && (
        <Section header="Пример">
          <Cell multiline>
            <i>{word.example}</i>
          </Cell>
        </Section>
      )}
      {contexts.length > 0 && (
        <Section header="Где встретилось">
          {contexts.map((text, i) => (
            <Cell key={i} multiline>
              <i>{text}</i>
            </Cell>
          ))}
        </Section>
      )}
      {word.collocations.length > 0 && (
        <Section header="Сочетания">
          {word.collocations.map((c) => (
            <Cell key={c.phrase} multiline subtitle={c.translation}>
              {c.phrase}
            </Cell>
          ))}
        </Section>
      )}
      <Section header="Как запомнить" footer={word.mnemonic ? "Новая запоминалка заменит эту у всех в комнате." : undefined}>
        {word.mnemonic && <Cell multiline>{word.mnemonic}</Cell>}
        <Cell
          onClick={async () => {
            if (thinking) return;
            setThinking(true);
            try {
              const mnemonic = await newMnemonic(word.id);
              setWord({ ...word, mnemonic });
              haptic.done(true);
            } catch (err) {
              haptic.done(false);
              notify(err instanceof Error ? err.message : String(err));
            } finally {
              setThinking(false);
            }
          }}
        >
          {thinking ? "💡 Придумываю… секунд 10" : word.mnemonic ? "💡 Придумать другую" : "💡 Придумать запоминалку"}
        </Cell>
      </Section>
      {word.hasPicture && <div className="picture word-picture">{picture && <img src={picture} alt="" />}</div>}

      <Section header="Управление словом">
        <Cell onClick={() => setEditing(true)}>✏️ Изменить перевод и объяснение</Cell>
        {word.usefulness === 1 && <Cell onClick={() => void act("promote")}>⭐ Сделать полезным — учить полностью</Cell>}
        {word.mine ? (
          <Cell multiline description="У остальных участников слово останется" onClick={() => void act("drop")}>
            🙈 Убрать только у меня
          </Cell>
        ) : (
          <Cell onClick={() => void act("restore")}>↩️ Вернуть в мои слова</Cell>
        )}
        <Cell className="danger" onClick={() => void act("delete")}>
          🗑 Удалить у всех
        </Cell>
      </Section>
    </List>
  );
}

/** ✏️ Перевод и объяснение. Само слово и пример не трогаем — прогресс у всех сохраняется. */
function EditForm({ word, onDone }: { word: WordDetails; onDone: (saved: boolean) => void }) {
  const [translation, setTranslation] = useState(word.translation);
  const [explanation, setExplanation] = useState(word.explanation);
  const [saving, setSaving] = useState(false);
  const cancel = () => onDone(false);

  const save = async () => {
    setSaving(true);
    try {
      await editWord(word.id, { translation, explanation });
      haptic.done(true);
      onDone(true);
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <List>
      <Section header={`✏️ ${word.term}`} footer="Если поменяешь перевод, запоминалка, картинка и сочетания подготовятся заново.">
        <Input header="Перевод" value={translation} onChange={(e) => setTranslation(e.target.value)} />
        <Textarea header="Объяснение" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </Section>
      <div className="row form-buttons">
        <Button mode="gray" size="l" stretched onClick={cancel}>
          Отмена
        </Button>
        <Button size="l" stretched loading={saving} disabled={!translation.trim()} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </List>
  );
}
