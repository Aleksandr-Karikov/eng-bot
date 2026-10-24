import { Cell, List, Placeholder, Progress as Bar, Section, Spinner, Text } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";
import { getProgress, type Progress } from "./api";
import { useBackButton } from "./telegram";

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** 2026-10-24 → «24 окт». */
const dayLabel = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
/** День недели по дате (Пн = 0). */
const weekday = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

/** 📊 Прогресс: серия и итоги, календарь занятий, прогноз повторений, цель комнаты, темы ошибок. */
export function ProgressScreen({ onExit }: { onExit: () => void }) {
  const [data, setData] = useState<Progress>();
  const [error, setError] = useState<string>();
  useBackButton(onExit);

  useEffect(() => {
    getProgress()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) return <Placeholder header="Не получилось загрузить" description={error} />;
  if (!data) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }
  const { stats } = data;
  return (
    <List>
      <div className="tiles">
        <Tile value={stats.streak} label={plural(stats.streak, "день подряд", "дня подряд", "дней подряд")} icon="🔥" />
        <Tile value={stats.learned} label="выучено" icon="✅" />
        <Tile value={stats.learning} label="учу" icon="📚" />
        <Tile value={stats.fresh} label="ещё не начато" icon="🆕" />
      </div>
      <Text className="hint week-line">
        За неделю: {stats.reviews7d} {plural(stats.reviews7d, "ответ", "ответа", "ответов")}, начато {data.started7d}{" "}
        {plural(data.started7d, "новое слово", "новых слова", "новых слов")}
      </Text>

      <Section header="Занятия за 12 недель">
        <Calendar days={data.calendar} />
      </Section>

      <Section header="Повторения на неделю" footer="Сколько карточек вернётся на повторение в каждый день, если заниматься каждый день.">
        <Forecast days={data.forecast} />
      </Section>

      {data.goal && (
        <Section header={`🎯 Цель «${data.goal.room}» на неделю`} footer={data.goal.auto ? "Цель подобрана сама по прошлой неделе. Своя — /goal в группе." : undefined}>
          <div className="goal">
            <Text weight="2">
              {data.goal.done} / {data.goal.target} {plural(data.goal.target, "ответ", "ответа", "ответов")}
              {data.goal.done >= data.goal.target ? " 🎉" : ""}
            </Text>
            <Bar value={Math.min(100, (data.goal.done / Math.max(1, data.goal.target)) * 100)} />
          </div>
          {data.goal.byUser.map((u) => (
            <Cell key={u.name} after={<Text className="hint">{u.count}</Text>}>
              {u.name}
            </Cell>
          ))}
        </Section>
      )}

      <Section
        header="🧠 Темы ошибок"
        footer={`Тема отработана после ${data.resolveStreak} верных ответов подряд в вопросах по ошибкам.`}
      >
        {data.topics.length === 0 && <Cell multiline>Открытых тем нет 👌 Ошибки собирает /check.</Cell>}
        {data.topics.map((t) => (
          <Cell key={t.category} multiline subtitle={`${t.count} ${plural(t.count, "ошибка", "ошибки", "ошибок")}`} after={<Dots done={t.streak} of={data.resolveStreak} />}>
            {t.category}
          </Cell>
        ))}
        {data.resolved.length > 0 && <Cell multiline description={data.resolved.join(", ")}>✅ Отработано недавно</Cell>}
      </Section>
    </List>
  );
}

function Tile({ value, label, icon }: { value: number; label: string; icon: string }) {
  return (
    <div className="tile">
      <div className="tile-value">
        {icon} {value}
      </div>
      <Text className="hint">{label}</Text>
    </div>
  );
}

/** Верных подряд из нужных: ●●○. */
function Dots({ done, of }: { done: number; of: number }) {
  return (
    <span className="dots" aria-label={`${done} из ${of}`}>
      {Array.from({ length: of }, (_, i) => (
        <span key={i} className={i < done ? "dot on" : "dot"} />
      ))}
    </span>
  );
}

/** Календарь: столбец — неделя (Пн сверху), клетка — день; ярче — больше ответов. Тап — сколько в тот день. */
function Calendar({ days }: { days: Progress["calendar"] }) {
  const [picked, setPicked] = useState<{ date: string; count: number }>();
  const max = Math.max(1, ...days.map((d) => d.count));
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
  const lead = days.length ? weekday(days[0].date) : 0;
  const cells: Array<{ date: string; count: number } | undefined> = [...Array.from({ length: lead }, () => undefined), ...days];
  const active = days.filter((d) => d.count > 0).length;
  return (
    <div className="calendar-wrap">
      {/* Колонок столько, сколько недель вышло с учётом сдвига к понедельнику (обычно 12–13). */}
      <div className="calendar" style={{ gridTemplateColumns: `22px repeat(${Math.ceil(cells.length / 7)}, 1fr)` }}>
        {WEEKDAYS.map((w, i) => (
          <span key={w} className="cal-label" style={{ gridRow: i + 1, gridColumn: 1 }}>
            {i % 2 === 0 ? w : ""}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d.date}
              className={`cal-cell l${level(d.count)}${picked?.date === d.date ? " picked" : ""}`}
              style={{ gridRow: (i % 7) + 1, gridColumn: Math.floor(i / 7) + 2 }}
              aria-label={`${dayLabel(d.date)}: ${d.count}`}
              onClick={() => setPicked(d)}
            />
          ) : null,
        )}
      </div>
      <Text className="hint cal-caption">
        {picked
          ? `${dayLabel(picked.date)} — ${picked.count} ${plural(picked.count, "ответ", "ответа", "ответов")}`
          : `Занимался ${active} ${plural(active, "день", "дня", "дней")} из ${days.length}. Тапни клетку — сколько в тот день.`}
      </Text>
    </div>
  );
}

/** Прогноз: столбик на день, число над ним. */
function Forecast({ days }: { days: Progress["forecast"] }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  return (
    <div className="forecast">
      {days.map((d, i) => (
        <div key={d.date} className="fc-day">
          <span className="fc-value">{d.count}</span>
          <div className="fc-track">
            <div className="fc-bar" style={{ height: `${d.count ? Math.max(6, (d.count / max) * 100) : 0}%` }} />
          </div>
          <span className="fc-label">{i === 0 ? "Сегодня" : i === 1 ? "Завтра" : WEEKDAYS[weekday(d.date)]}</span>
        </div>
      ))}
    </div>
  );
}
