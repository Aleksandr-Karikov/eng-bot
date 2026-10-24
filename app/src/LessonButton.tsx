import { Button } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import { requestLesson } from "./api";
import { haptic, notify } from "./telegram";

/** «🎧 Аудиоурок в чат»: mp3 придёт от бота — его Telegram играет в фоне, с погасшим экраном. */
export function LessonButton() {
  const [sent, setSent] = useState(false);
  return (
    <Button
      mode="bezeled"
      size="m"
      stretched
      disabled={sent}
      onClick={async () => {
        try {
          const status = await requestLesson();
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
      }}
    >
      {sent ? "🎧 Урок придёт в чат" : "🎧 Аудиоурок в чат"}
    </Button>
  );
}
