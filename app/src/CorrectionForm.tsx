import { Button, Cell, List, Section, Spinner, Text, Textarea } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useState } from "react";
import { applyCorrection, correctWord, getWord, invalidateWordMedia, wordPictureUrl, type CorrectionPreview, type WordDetails } from "./api";
import { usefulnessIcon } from "./format";
import { clearAudioCache } from "./sound";
import { haptic, useBackButton } from "./telegram";

export function CorrectionForm({ word, onDone }: { word: { id: number; term: string; translation: string }; onDone: (saved: boolean) => void }) {
  const [original, setOriginal] = useState<WordDetails>();
  const [preview, setPreview] = useState<CorrectionPreview>();
  const [instruction, setInstruction] = useState("");
  const [messages, setMessages] = useState<Array<{ request: string; reply: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [picture, setPicture] = useState<string>();
  const cancel = useCallback(() => { if (!busy) onDone(saved); }, [busy, saved, onDone]);
  useBackButton(cancel);
  useEffect(() => {
    let active = true;
    getWord(word.id).then((w) => {
      if (!active) return;
      setOriginal(w);
      if (w.hasPicture) void wordPictureUrl(w.id).then((url) => { if (active) setPicture(url); });
    }).catch((err) => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; };
  }, [word.id]);

  const propose = async () => {
    if (busy || !instruction.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await correctWord(word.id, instruction, preview?.draftId);
      setPreview(next);
      setMessages((items) => [...items, { request: instruction, reply: next.message }]);
      setInstruction("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      haptic.done(false);
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (busy || !preview || instruction.trim()) return;
    setBusy(true);
    setError("");
    try {
      await applyCorrection(word.id, preview.draftId);
      invalidateWordMedia();
      clearAudioCache();
      setSaved(true);
      haptic.done(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      haptic.done(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <List>
      <Section header={`✏️ ${word.term}`}>
        <Cell multiline>{saved ? "✅ Исправление сохранено. Прогресс обучения сохранён." : "Карточка не изменится, пока ты не нажмёшь «Применить изменения». Правка будет общей для комнаты."}</Cell>
      </Section>
      {messages.map((message, i) => (
        <Section key={i} header={i ? "Уточнение и ответ ИИ" : "Запрос и ответ ИИ"}>
          <Cell multiline subtitle="Твой запрос">{message.request}</Cell>
          <Cell multiline subtitle="Ответ ИИ">{message.reply}</Cell>
        </Section>
      ))}
      {original ? <CardComparison before={preview?.before ?? original} after={preview?.after} picture={picture} effects={preview?.effects ?? []} /> : !error && <Spinner size="m" />}
      {!saved && (
        <Section header={preview ? "Уточнить исправление" : "Что исправить?"} footer={preview ? "Уточнение подготовит новый вариант. Сравни его перед применением." : undefined}>
          <Textarea aria-label="Запрос к ИИ" placeholder="Здесь множественное число — нужна начальная форма, а формы опиши в объяснении" value={instruction} maxLength={1000} disabled={busy} onChange={(e) => setInstruction(e.target.value)} />
        </Section>
      )}
      {error && <Text role="alert" className="block">{error}</Text>}
      <div className="actions form-buttons">
        {!saved && <Button mode="bezeled" size="l" stretched loading={busy} disabled={busy || !original || !instruction.trim()} onClick={() => void propose()}>{preview ? "Уточнить с ИИ" : "Предложить исправление"}</Button>}
        {preview && !saved && <Button size="l" stretched disabled={busy || Boolean(instruction.trim())} onClick={() => void approve()}>Применить изменения</Button>}
        <Button mode="gray" size="l" stretched disabled={busy} onClick={cancel}>{saved ? "Готово" : "Отмена — не сохранять"}</Button>
      </div>
    </List>
  );
}

function fields(word: WordDetails): Array<[string, string]> {
  return [
    ["Слово", word.term], ["Перевод", word.translation], ["Объяснение", word.explanation], ["Пример", word.example],
    ["Транскрипция / романизация", word.transcriptionUk], ["Американская транскрипция", word.transcriptionUs],
    ["Часть речи", word.partOfSpeech], ["Уровень", word.cefr],
    ["Другие формы", word.forms.map((f) => `${f.form}${f.label ? ` — ${f.label}` : ""}`).join("\n")],
    ["Синонимы", word.synonyms.map((s) => `${s.term} — ${s.translation}`).join("\n")],
    ["Антонимы", word.antonyms.map((a) => `${a.term} — ${a.translation}`).join("\n")],
    ["Запоминалка", word.mnemonic], ["Разбор трудного слова", word.leechHelp],
    ["Сочетания", word.collocations.map((c) => `${c.phrase} — ${c.translation}`).join("\n")],
    ["Где встретилось", [word.context, ...word.moreContexts.map((c) => `${c.text}${c.title ? ` (${c.title})` : ""}`)].filter(Boolean).join("\n")],
    ["Полезность", `${usefulnessIcon(word.usefulness)} ${word.usefulnessNote || (word.usefulness == null ? "Пока не оценена" : "")}`],
  ];
}

function CardComparison({ before, after, picture, effects }: { before: WordDetails; after?: WordDetails; picture?: string; effects: string[] }) {
  const oldFields = fields(before);
  const newFields = after && fields(after);
  return (
    <Section header={after ? "Полная карточка: было → предложено" : "Текущая карточка"}>
      {oldFields.map(([label, value], i) => {
        const next = newFields?.[i][1];
        const changed = next !== undefined && next !== value;
        return (
          <div key={label} className={`correction-field${changed ? " correction-changed" : ""}`}>
            <Text weight="2">{label}{changed ? " · изменено" : ""}</Text>
            <div className={after ? "correction-pair" : ""}>
              <div><Text className="hint">{after ? "Было" : ""}</Text><p>{value || "—"}</p></div>
              {after && <div><Text className="hint">Предложено</Text><p>{next || "—"}</p></div>}
            </div>
          </div>
        );
      })}
      {picture && <div className="picture word-picture"><img src={picture} alt="Текущая картинка карточки" /></div>}
      {effects.map((effect) => <Cell key={effect} multiline subtitle="После применения">{effect}</Cell>)}
    </Section>
  );
}
