import { Button, Text } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import { requestLesson, type LessonAccent } from "./api";
import { haptic, notify } from "./telegram";

const ACCENTS: Array<{ id: LessonAccent; label: string }> = [
  { id: "uk", label: "🇬🇧 UK" },
  { id: "us", label: "🇺🇸 US" },
  { id: "mix", label: "🔀 Оба" },
];

/** 🎧 Аудиоурок в чат с выбором акцента: mp3 придёт от бота — его Telegram играет в фоне, с погасшим экраном. */
export function LessonButton() {
  const [sent, setSent] = useState(false);
  const ask = async (accent: LessonAccent) => {
    try {
      const status = await requestLesson(accent);
      haptic.done(status !== "empty");
      setSent(true);
      notify(
        status === "empty"
          ? "Пока нечего слушать — сначала начни учить слова."
          : "Собираю аудиоурок — через минуту-две он придёт в чат с ботом. Его можно слушать в фоне, с погасшим экраном.",
      );
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    }
  };
  if (sent) return <Text className="hint lesson-sent">🎧 Урок придёт в чат с ботом</Text>;
  return (
    <div className="lesson">
      <Text className="hint">🎧 Аудиоурок в чат — каким акцентом?</Text>
      <div className="row">
        {ACCENTS.map((a) => (
          <Button key={a.id} mode="bezeled" size="m" stretched onClick={() => void ask(a.id)}>
            {a.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
