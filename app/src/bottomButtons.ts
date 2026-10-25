import { reportClientError } from "./api";
import { mainButton, secondaryButton } from "@telegram-apps/sdk-react";
import { useEffect, useState } from "react";

/** Кнопка внизу: текст и что делать по нажатию; undefined — спрятать. */
export interface BottomButton {
  text: string;
  onClick: () => void;
}

/** Нативные кнопки Telegram (Main и Secondary) — один раз на приложение; false — их нет (старый Telegram или браузер). */
let native: boolean | undefined;
function nativeAvailable(): boolean {
  if (native !== undefined) return native;
  try {
    mainButton.mount();
    secondaryButton.mount();
    native = secondaryButton.isSupported();
  } catch {
    native = false;
  }
  return native;
}

/**
 * Кнопки внизу экрана: «Показать ответ», «Помню» / «Забыл». В Telegram — нативные (всегда видны, в стиле
 * клиента, не скроллятся вместе с карточкой). Без них — вернёт false, и экран рисует свою закреплённую панель.
 */
export function useBottomButtons(main?: BottomButton, secondary?: BottomButton): boolean {
  const [isNative, setNative] = useState(nativeAvailable);
  useEffect(() => {
    if (!isNative) return;
    const offs: Array<() => void> = [];
    // Каждая кнопка — отдельно: сбой второй не должен оставить первую со старым текстом.
    const setup = (where: string, apply: () => void): boolean => {
      try {
        apply();
        return true;
      } catch (err) {
        reportClientError(`bottom buttons: ${where}`, err);
        return false;
      }
    };
    const ok =
      setup("main", () => {
        mainButton.setParams({ text: main?.text ?? "", isVisible: Boolean(main), isEnabled: true });
        if (main) offs.push(mainButton.onClick(main.onClick));
      }) &&
      setup("secondary", () => {
        secondaryButton.setParams({ text: secondary?.text ?? "", isVisible: Boolean(secondary), isEnabled: true, position: "left" });
        if (secondary) offs.push(secondaryButton.onClick(secondary.onClick));
      });
    if (!ok) {
      // Нативные кнопки не слушаются — прячем их (иначе висели бы со старым «Показать ответ») и рисуем свою панель.
      hideNative();
      native = false;
      setNative(false);
    }
    return () => offs.forEach((off) => off());
  }, [isNative, main?.text, secondary?.text, main?.onClick, secondary?.onClick]);
  // Экран ушёл (загрузка, ошибка) — кнопки не должны остаться висеть со старым текстом.
  useEffect(
    () => () => {
      if (native) hideNative();
    },
    [isNative],
  );
  return isNative;
}

/** Спрятать обе нативные кнопки — каждую отдельно: если одна не слушается, вторая всё равно спрячется. */
function hideNative(): void {
  for (const button of [mainButton, secondaryButton]) {
    try {
      button.setParams({ isVisible: false });
    } catch {
      // эта не работает — прятать нечего
    }
  }
}
