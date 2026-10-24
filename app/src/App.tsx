import { settingsButton } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useState } from "react";
import { Learn } from "./Learn";
import { SettingsScreen } from "./Settings";
import { Triage } from "./Triage";
import { Words } from "./Words";
import { haptic } from "./telegram";

type Page = "learn" | "words" | "settings" | "triage";

/** Страницу можно открыть сразу: …/app/?tab=words. */
function startPage(): Page {
  const asked = new URLSearchParams(window.location.search).get("tab");
  return asked === "words" || asked === "settings" || asked === "triage" ? asked : "learn";
}

/**
 * Главное — карточки на весь экран. Слова и настройки — отдельные страницы: кнопки 📖 и ⚙️ в углу,
 * настройки ещё и из штатного меню Telegram (⋮ → «Настройки»); назад — нативной кнопкой «Назад».
 */
export function App() {
  const [page, setPage] = useState<Page>(startPage);
  const open = useCallback((next: Page) => {
    haptic.select();
    setPage(next);
  }, []);
  const back = useCallback(() => setPage("learn"), []);

  useEffect(() => {
    let off: (() => void) | undefined;
    try {
      settingsButton.mount();
      settingsButton.show();
      off = settingsButton.onClick(() => open("settings"));
    } catch {
      // нет в этой версии Telegram или открыто вне Telegram
    }
    return () => off?.();
  }, [open]);

  if (page === "words") return <Words onExit={back} />;
  if (page === "settings") return <SettingsScreen onExit={back} />;
  if (page === "triage") return <Triage onExit={back} />;
  return (
    <Learn
      onTriage={() => open("triage")}
      corner={
        <div className="corner">
          <button className="corner-button" aria-label="Слова" onClick={() => open("words")}>
            📖
          </button>
          <button className="corner-button" aria-label="Настройки" onClick={() => open("settings")}>
            ⚙️
          </button>
        </div>
      }
    />
  );
}
