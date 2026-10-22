import { backButton, hapticFeedback, popup } from "@telegram-apps/sdk-react";
import { useEffect } from "react";

/** Вне Telegram (в браузере) части SDK нет — тогда просто молчим. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // нет в этой версии Telegram или открыто вне Telegram
  }
}

export const haptic = {
  tap: (kind: "light" | "medium" = "light") => safe(() => hapticFeedback.impactOccurred(kind)),
  select: () => safe(() => hapticFeedback.selectionChanged()),
  done: (ok: boolean) => safe(() => hapticFeedback.notificationOccurred(ok ? "success" : "error")),
};

/** Нативная кнопка «Назад» в шапке Telegram, пока экран открыт. */
export function useBackButton(onBack: () => void): void {
  useEffect(() => {
    let off: (() => void) | undefined;
    safe(() => {
      backButton.mount();
      backButton.show();
      off = backButton.onClick(onBack);
    });
    return () => {
      off?.();
      safe(() => backButton.hide());
    };
  }, [onBack]);
}

/** Подтверждение опасного действия: нативное окно Telegram, вне его — обычный confirm. */
export async function confirmDanger(message: string, action: string): Promise<boolean> {
  try {
    if (popup.isSupported()) {
      const id = await popup.open({ message, buttons: [{ id: "ok", type: "destructive", text: action }, { type: "cancel" }] });
      return id === "ok";
    }
  } catch {
    // нет окна — ниже обычный confirm
  }
  return window.confirm(message);
}

/** Короткое сообщение (ошибка действия): нативное окно или alert. */
export function notify(message: string): void {
  try {
    if (popup.isSupported()) return void popup.open({ message });
  } catch {
    // ниже alert
  }
  window.alert(message);
}
