import { Button, Placeholder, Spinner, Text, Title } from "@telegram-apps/telegram-ui";
import { useEffect, useRef, useState } from "react";
import type { DailyTasksState } from "../../src/services/study-activities";
import { claimDailyTask, getDailyTasks } from "./api";
import { useBackButton } from "./telegram";

type Task = DailyTasksState["tasks"][number];

export function DailyTasksScreen({ onExit, onOpen }: { onExit: () => void; onOpen: (id: Task["id"]) => void }) {
  useBackButton(onExit);
  const [data, setData] = useState<DailyTasksState>();
  const [error, setError] = useState<string>();
  const [claiming, setClaiming] = useState<string>();
  const [retry, setRetry] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    getDailyTasks().then((state) => {
      if (active) setData(state);
    }).catch((err: unknown) => {
      if (active) setError(err instanceof Error ? err.message : "Не получилось загрузить задания.");
    });
    return () => { active = false; };
  }, [retry]);

  const reload = () => { setError(undefined); setRetry((value) => value + 1); };
  const claim = async (task: Task, day: string) => {
    if (pending.current) return;
    pending.current = true;
    setClaiming(task.id);
    setError(undefined);
    try {
      setData(await claimDailyTask(task.id, day));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не получилось забрать награду.");
    } finally {
      pending.current = false;
      setClaiming(undefined);
    }
  };
  if (!data) return error
    ? <Placeholder header="Задания недоступны" description={error} action={<Button onClick={reload}>Попробовать снова</Button>} />
    : <div className="center"><Spinner size="l" /></div>;

  return (
    <div className="screen preview word-guess">
      <Title Component="h1" level="2" weight="2">Задания на день</Title>
      {!data.canClaim && <Text className="hint">Включи режим босса, чтобы забирать награды за задания.</Text>}
      {data.tasks.map((task) => (
        <section className="word-guess-target daily-task" key={task.id} aria-label={task.title}>
          <div className="daily-task-head">
            <Text weight="2">{task.title}</Text>
            <Text className="word-guess-phrase">+{task.reward} ⚡</Text>
          </div>
          <progress value={task.progress} max={task.target} aria-label={task.title} />
          <Text className="hint">{task.progress} из {task.target}</Text>
          {task.claimed ? <Text weight="2">Награда получена</Text> : task.progress === task.target ? (
            <Button size="m" disabled={!data.canClaim || Boolean(claiming)} loading={claiming === task.id}
              onClick={() => void claim(task, data.day)}>Забрать {task.reward} ⚡</Button>
          ) : <Button size="m" mode="bezeled" disabled={Boolean(claiming)} onClick={() => onOpen(task.id)}>К заданию</Button>}
        </section>
      ))}
      {error && <div className="actions">
        <Text className="danger" role="alert">{error}</Text>
        <Button size="m" mode="plain" onClick={reload}>Обновить задания</Button>
      </div>}
    </div>
  );
}
