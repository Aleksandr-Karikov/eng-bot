import { init, miniApp, swipeBehavior, themeParams, viewport } from "@telegram-apps/sdk-react";
import { AppRoot } from "@telegram-apps/telegram-ui";
import "@telegram-apps/telegram-ui/dist/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

/** Каждый шаг отдельно: вне Telegram (в обычном браузере) часть функций недоступна — приложение всё равно покажет экран. */
function setupTelegram(): void {
  const steps: Array<() => unknown> = [
    () => init(),
    () => miniApp.mountSync(),
    () => themeParams.mountSync(),
    () => themeParams.bindCssVars(),
    // Свайп карточки вниз не должен закрывать приложение.
    () => swipeBehavior.mount(),
    () => swipeBehavior.disableVertical(),
    () => viewport.mount().then(() => viewport.expand()),
    () => miniApp.ready(),
  ];
  for (const step of steps) {
    try {
      void step();
    } catch {
      // нет в этой версии Telegram или открыто вне Telegram
    }
  }
}

/** Тёмная или светлая — как тема Telegram, а не как система телефона (они могут не совпадать). */
function appearance(): "dark" | "light" | undefined {
  try {
    return themeParams.isDark() ? "dark" : "light";
  } catch {
    return undefined;
  }
}

setupTelegram();
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppRoot appearance={appearance()}>
      <App />
    </AppRoot>
  </StrictMode>,
);
