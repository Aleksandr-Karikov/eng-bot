import { studyLanguage } from "./language";

import { Button, Text } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import { requestLesson, type LessonAccent } from "./api";
import { ButtonIcon, IconHeadphones } from "./icons";
import { haptic, notify } from "./telegram";

const ACCENTS: Array<{ id: LessonAccent; label: string }> = [
  { id: "uk", label: "UK" },
  { id: "us", label: "US" },
  { id: "mix", label: "Оба" },
];

/** Аудиоурок в чат с выбором акцента: mp3 придёт от бота — его Telegram играет в фоне, с погасшим экраном. */
export function LessonButton() {
  const [status, setStatus] = useState<"empty" | "sent">();
  const [pending, setPending] = useState<LessonAccent>();
  const ask = async (accent: LessonAccent) => {
    if (pending) return;
    setPending(accent);
    try {
      const result = await requestLesson(accent);
      haptic.done(result !== "empty");
      setStatus(result === "empty" ? "empty" : "sent");
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(undefined);
    }
  };
  return (
    <details className="lesson">
      <summary>
        <ButtonIcon><IconHeadphones size={18} />Аудиоурок в чат</ButtonIcon>
      </summary>
      {status === "sent" ? <Text className="hint lesson-sent" role="status">Урок придёт в чат с ботом</Text> : <>
        <div className="row">
          {(studyLanguage().accents.length === 1 ? [{ id: studyLanguage().accents[0].key as LessonAccent, label: "Собрать урок" }] : ACCENTS).map((a) => (
            <Button key={a.id} mode="bezeled" size="m" stretched disabled={pending !== undefined}
              loading={pending === a.id} onClick={() => void ask(a.id)}>
              {a.label}
            </Button>
          ))}
        </div>
        {status === "empty" && <Text className="hint lesson-sent" role="status">Пока нечего слушать. Начни учить слова.</Text>}
      </>}
    </details>
  );
}
