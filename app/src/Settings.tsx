import { Cell, List, Placeholder, Section, Select, Spinner, Switch } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";
import { changeSetting, getSettings, type SettingChange, type Settings, type Toggle } from "./api";
import { haptic, notify, useBackButton } from "./telegram";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

/** ⚙️ Те же настройки, что /settings в боте: каждое изменение сохраняется сразу. */
export function SettingsScreen({ onExit }: { onExit: () => void }) {
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
    } catch (err) {
      haptic.done(false);
      notify(err instanceof Error ? err.message : String(err));
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

  return (
    <List>
      <Section header="Комната" footer="Сюда попадают новые слова и отсюда — карточки.">
        {settings.rooms.length === 0 && <Cell multiline>Пока ни одной — создай в боте: /newroom</Cell>}
        {settings.rooms.map((r) => (
          <Cell key={r.id} after={r.current ? "✓" : undefined} onClick={() => !r.current && void change({ room: r.id })}>
            {r.name}
          </Cell>
        ))}
      </Section>

      <Section header="⏰ Напоминания">
        <Select header="Напоминать в" value={settings.reminderHour} onChange={(e) => void change({ reminderHour: Number(e.target.value) })}>
          {HOURS.map((h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, "0")}:00
            </option>
          ))}
        </Select>
        <SwitchCell label="🔔 Когда снова есть что повторить" on={settings.notifyDue} onChange={() => void change({ notifyDue: !settings.notifyDue })} />
        <SwitchCell label="📬 Итог недели в воскресенье" on={settings.weeklyReport} onChange={() => void change({ weeklyReport: !settings.weeklyReport })} />
      </Section>

      <Section header="🎯 Упражнения" footer="Хотя бы одно должно остаться включённым.">
        {toggles(settings.modes, (t) => ({ mode: t.key, on: !t.on }))}
        <SwitchCell label="🧠 Вопросы по ошибкам в /learn" on={settings.drill} onChange={() => void change({ drill: !settings.drill })} />
      </Section>

      <Section header="🃏 Карточка" footer="Что показывать на обороте карточки.">
        {toggles(settings.card, (t) => ({ cardPart: t.key, on: !t.on }))}
      </Section>
    </List>
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
