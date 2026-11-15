import { Button, List, Section, Text, Textarea } from "@telegram-apps/telegram-ui";
import { useCallback, useState } from "react";
import { correctWord, invalidateWordMedia } from "./api";
import { clearAudioCache } from "./sound";
import { haptic, useBackButton } from "./telegram";

export function CorrectionForm({ word, onDone }: { word: { id: number; term: string; translation: string }; onDone: (saved: boolean) => void }) {
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const cancel = useCallback(() => { if (!saving) onDone(false); }, [saving, onDone]);
  useBackButton(cancel);

  const save = async () => {
    if (saving || !instruction.trim()) return;
    setSaving(true);
    setError("");
    try {
      await correctWord(word.id, instruction);
      invalidateWordMedia();
      clearAudioCache();
      haptic.done(true);
      onDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
      haptic.done(false);
    }
  };

  return (
    <List>
      <Section header={`✏️ ${word.term} — ${word.translation}`} footer="Исправление сохранится у всех в комнате. Прогресс обучения останется.">
        <Textarea header="Что исправить?" placeholder="Здесь множественное число — нужна начальная форма, а формы опиши в объяснении" value={instruction} maxLength={1000} disabled={saving} onChange={(e) => setInstruction(e.target.value)} />
      </Section>
      {error && <Text role="alert" className="block">{error}</Text>}
      <div className="row form-buttons">
        <Button mode="gray" size="l" stretched disabled={saving} onClick={cancel}>Отмена</Button>
        <Button size="l" stretched loading={saving} disabled={saving || !instruction.trim()} onClick={() => void save()}>
          {saving ? "Исправляю…" : "Исправить и сохранить"}
        </Button>
      </div>
    </List>
  );
}
