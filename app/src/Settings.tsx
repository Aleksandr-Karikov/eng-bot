import { Button, Cell, Input, List, Placeholder, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";
import { changeSetting, getSettings, type SettingChange, type Settings, type Toggle } from "./api";
import { haptic, notify, useBackButton } from "./telegram";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** Те же настройки, что /settings в боте: каждое изменение сохраняется сразу. */
export function SettingsScreen({ onExit, limitsFirst }: { onExit: () => void; limitsFirst: boolean }) {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  useBackButton(onExit);

  useEffect(() => {
    getSettings()
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const change = async (c: SettingChange) => {
    haptic.select();
    try {
      setSettings(await changeSetting(c));
      return true;
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
      return false;
    }
  };

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!settings) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }

  const toggles = (items: Toggle[], toChange: (t: Toggle) => SettingChange) =>
    items.map((t) => <SwitchCell key={t.key} label={t.label} on={t.on} onChange={() => void change(toChange(t))} />);

  const limits = (
    <>
      <Section
        header="🆕 Новые слова в день"
        footer="Сколько новых слов можно начать за день, пока есть место в «Учу». Ноль снимает дневной лимит."
      >
        <LimitField key={settings.newPerDay} label="Новые слова в день" value={settings.newPerDay} min={0}
          max={settings.learningLimits.max} recommended={settings.learningLimits.recommendedDaily}
          onSave={(newPerDay) => change({ newPerDay })} />
      </Section>

      <Section header="📚 Подборка «Учу»" footer="Повторы с интервалом от недели освобождают место. Забытые слова могут временно увеличить подборку.">
        <LimitField key={settings.activeLearningLimit} label="Слов одновременно" value={settings.activeLearningLimit} min={1}
          max={settings.learningLimits.max} recommended={settings.learningLimits.recommendedActive}
          onSave={(activeLearningLimit) => change({ activeLearningLimit })} />
      </Section>
    </>
  );

  return (
    <List>
      {limitsFirst && limits}
      <Section header="Комната" footer="Сюда попадают новые слова и отсюда — карточки.">
        {settings.rooms.length === 0 && <Cell multiline>Пока ни одной — создай в боте: /newroom</Cell>}
        {settings.rooms.map((r) => (
          <Cell key={r.id} after={r.current ? "✓" : undefined} onClick={() => !r.current && void change({ room: r.id })}>
            {r.name}
          </Cell>
        ))}
      </Section>
      {!limitsFirst && limits}

      <Section header="⏰ Напоминания">
        <Select header="Напоминать в" value={settings.reminderHour} onChange={(e) => void change({ reminderHour: Number(e.target.value) })}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </Select>
        <SwitchCell label="Когда снова есть что повторить" on={settings.notifyDue} onChange={() => void change({ notifyDue: !settings.notifyDue })} />
        <SwitchCell label="Итог недели в воскресенье" on={settings.weeklyReport} onChange={() => void change({ weeklyReport: !settings.weeklyReport })} />
      </Section>

      <Section header="🎯 Упражнения" footer="Хотя бы одно должно остаться включённым.">
        {toggles(settings.modes, (t) => ({ mode: t.key, on: !t.on }))}
        <SwitchCell label="Вопросы по ошибкам в /learn" on={settings.drill} onChange={() => void change({ drill: !settings.drill })} />
        {settings.boss !== undefined && (
          <SwitchCell label="Босс недели" on={settings.boss} onChange={() => void change({ boss: !settings.boss })} />
        )}
      </Section>

      <Section header="🃏 Карточка" footer="Что показывать на обороте карточки.">
        {toggles(settings.card, (t) => ({ cardPart: t.key, on: !t.on }))}
      </Section>

      <Section header="🔊 Озвучка карточек" footer="В приложении выбранный вариант звучит сам, как только карточка показала ответ. В боте слово всегда по кнопке.">
        {settings.voice.accents.map((a) => (
          <Cell key={a.key} after={settings.voice.accent === a.key ? "✓" : undefined} onClick={() => void change({ voice: a.key })}>
            {settings.voice.accents.length === 1 ? "Озвучка" : a.key.toUpperCase()}
          </Cell>
        ))}
        <Cell after={settings.voice.accent === null ? "✓" : undefined} onClick={() => void change({ voice: "off" })}>
          Не включать
        </Cell>
      </Section>
    </List>
  );
}

function LimitField({ label, value, min, max, recommended, onSave }: {
  label: string;
  value: number;
  min: number;
  max: number;
  recommended: number;
  onSave: (value: number) => Promise<boolean>;
}) {
  const [text, setText] = useState(String(value));
  const [busy, setBusy] = useState(false);
  const number = Number(text);
  const valid = /^\d+$/.test(text) && number >= min && number <= max;
  const save = async (next: number) => {
    if (busy) return;
    setBusy(true);
    if (await onSave(next)) setText(String(next));
    setBusy(false);
  };
  return (
    <form aria-label={label} onSubmit={(event) => { event.preventDefault(); if (valid && number !== value) void save(number); }}>
      <Input aria-label={label} inputMode="numeric" value={text} status={valid ? "default" : "error"}
        disabled={busy} onChange={(event) => setText(event.target.value)} />
      <div className="form-buttons actions">
        {!valid && <span className="hint">Введи целое число от {min} до {max}.</span>}
        <div className="list-actions">
          <Button size="m" type="submit" disabled={busy || !valid || number === value}>Сохранить</Button>
          {value === recommended && text === String(recommended) ? <span className="hint">Рекомендуем {recommended}</span> : (
            <Button size="m" type="button" mode="plain" disabled={busy}
              onClick={() => value === recommended ? setText(String(value)) : void save(recommended)}>
              Сбросить до {recommended}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/** Строка с переключателем: нажать можно на всю строку. */
function SwitchCell({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) {
  return (
    <Cell Component="label" multiline after={<Switch checked={on} onChange={onChange} />}>
      {label}
    </Cell>
  );
}
