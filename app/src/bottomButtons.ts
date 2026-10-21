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
  const [isNative] = useState(nativeAvailable);
  useEffect(() => {
    if (!isNative) return;
    const offs: Array<() => void> = [];
    mainButton.setParams({ text: main?.text ?? "", isVisible: Boolean(main), isEnabled: true });
    if (main) offs.push(mainButton.onClick(main.onClick));
    secondaryButton.setParams({ text: secondary?.text ?? "", isVisible: Boolean(secondary), isEnabled: true, position: "left" });
    if (secondary) offs.push(secondaryButton.onClick(secondary.onClick));
    return () => offs.forEach((off) => off());
  }, [isNative, main?.text, secondary?.text, main?.onClick, secondary?.onClick]);
  // Экран ушёл (загрузка, ошибка) — кнопки не должны остаться висеть со старым текстом.
  useEffect(
    () => () => {
      if (!isNative) return;
      mainButton.setParams({ isVisible: false });
      secondaryButton.setParams({ isVisible: false });
    },
    [isNative],
  );
  return isNative;
}
