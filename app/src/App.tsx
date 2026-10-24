import { getMe } from "./api";
import { setStudyLanguage } from "./language";

import { settingsButton } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useState } from "react";
import { Learn } from "./Learn";
import { ProgressScreen } from "./Progress";
import { Sets } from "./Sets";
import { SettingsScreen } from "./Settings";
import { Triage } from "./Triage";
import { Words } from "./Words";
import { haptic } from "./telegram";

type Page = "learn" | "words" | "settings" | "triage" | "progress" | "sets";

/** Страницу можно открыть сразу: …/app/?tab=words. */
function startPage(): Page {
  const asked = new URLSearchParams(window.location.search).get("tab");
  const pages: Page[] = ["words", "settings", "triage", "progress", "sets"];
  return pages.find((p) => p === asked) ?? "learn";
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
  // Изучаемый язык нужен и страницам, открытым сразу по ссылке (?tab=), не только карточкам.
  const [, setLanguageLoaded] = useState(false);
  useEffect(() => {
    getMe()
      .then((me) => {
        setStudyLanguage(me.language);
        setLanguageLoaded(true);
      })
      .catch(() => {});
  }, []);

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

  if (page === "words") return <Words onExit={back} onSets={() => open("sets")} />;
  if (page === "settings") return <SettingsScreen onExit={back} />;
  if (page === "triage") return <Triage onExit={back} />;
  if (page === "progress") return <ProgressScreen onExit={back} />;
  if (page === "sets") return <Sets onExit={back} />;
  return (
    <Learn
      onTriage={() => open("triage")}
      onSets={() => open("sets")}
      corner={
        <div className="corner">
          <button className="corner-button" aria-label="Прогресс" onClick={() => open("progress")}>
            📊
          </button>
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
