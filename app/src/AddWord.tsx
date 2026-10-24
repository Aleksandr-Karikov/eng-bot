import { studyLanguage } from "./language";

import { Button, Input, List, Section, Spinner, Text, Textarea, Title } from "@telegram-apps/telegram-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { addWord, prepareWord, type WordDraft } from "./api";
import { useBottomButtons } from "./bottomButtons";
import { transcription, USEFULNESS } from "./format";
import { haptic, notify, useBackButton } from "./telegram";

/**
 * ➕ Новое слово: пишешь слово или фразу (можно по-русски — подберётся английское), бот готовит карточку,
 * перевод и объяснение можно поправить, «Добавить» — в комнату, друзьям приходит «знаешь?». Можно добавлять подряд.
 */
export function AddWord({ onExit }: { onExit: () => void }) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<WordDraft>();
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  // Назад с карточки — к вводу, с ввода — к списку слов.
  const back = useCallback(() => (draft ? setDraft(undefined) : onExit()), [draft, onExit]);
  useBackButton(back);
  useEffect(() => {
    if (!draft) input.current?.focus();
  }, [draft]);

  const prepare = useCallback(async () => {
    if (busy || !text.trim()) return;
    setBusy(true);
    try {
      setDraft(await prepareWord(text));
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, text]);

  const save = useCallback(async () => {
    if (busy || !draft?.translation.trim()) return;
    setBusy(true);
    try {
      await addWord(draft);
      haptic.done(true);
      setAdded((a) => [draft.term, ...a]);
      setDraft(undefined);
      setText("");
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [busy, draft]);

  const native = useBottomButtons(
    busy ? undefined : draft ? { text: "➕ Добавить", onClick: () => void save() } : { text: "Подготовить карточку", onClick: () => void prepare() },
    !busy && draft ? { text: "Отмена", onClick: () => setDraft(undefined) } : undefined,
  );

  return (
    <List>
      {!draft ? (
        <Section header="➕ Новое слово" footer={studyLanguage().code === "en" ? "Слово или фразу, можно с переводом через тире: bank — берег. Можно по-русски — подберу английское." : `Слово или фразу, можно с переводом через тире. Можно по-русски — подберу ${studyLanguage().neut}.`}>
          <Input
            ref={input}
            placeholder="Например: cut to the chase"
            value={text}
            disabled={busy}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void prepare()}
          />
        </Section>
      ) : (
        <Section header="Проверь и добавь">
          <div className="word-head">
            <Title level="1" weight="2">
              {draft.term} {draft.usefulness ? USEFULNESS[draft.usefulness] : ""}
            </Title>
            {transcription({ transcriptionUk: draft.transcriptionUk ?? "", transcriptionUs: draft.transcriptionUs ?? "" }) && (
              <Text className="hint">{transcription({ transcriptionUk: draft.transcriptionUk ?? "", transcriptionUs: draft.transcriptionUs ?? "" })}</Text>
            )}
          </div>
          <Input header="Перевод" value={draft.translation} onChange={(e) => setDraft({ ...draft, translation: e.target.value })} />
          <Textarea header="Объяснение" value={draft.explanation} onChange={(e) => setDraft({ ...draft, explanation: e.target.value })} />
          {draft.example && (
            <Text className="block draft-extra">
              <b>Пример:</b> <i>{draft.example}</i>
            </Text>
          )}
          {draft.mnemonic && (
            <Text className="block draft-extra">
              <b>Как запомнить:</b> {draft.mnemonic}
            </Text>
          )}
        </Section>
      )}

      {busy && (
        <div className="center checking">
          <Spinner size="m" />
          <Text className="hint">{draft ? "Добавляю…" : "Готовлю карточку — секунд 5–10…"}</Text>
        </div>
      )}

      {!native && !busy && (
        <div className="row form-buttons">
          {draft && (
            <Button mode="gray" size="l" stretched onClick={() => setDraft(undefined)}>
              Отмена
            </Button>
          )}
          <Button size="l" stretched onClick={() => void (draft ? save() : prepare())}>
            {draft ? "➕ Добавить" : "Подготовить карточку"}
          </Button>
        </div>
      )}

      {added.length > 0 && (
        <Section header="Добавлено сейчас">
          <Text className="block draft-extra">✅ {added.join(", ")}</Text>
        </Section>
      )}
    </List>
  );
}
