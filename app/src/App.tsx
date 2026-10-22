import { Tabbar } from "@telegram-apps/telegram-ui";
import { useState } from "react";
import { Learn } from "./Learn";
import { SettingsScreen } from "./Settings";
import { Words } from "./Words";
import { haptic } from "./telegram";

const TABS = [
  { id: "learn", icon: "📚", text: "Карточки" },
  { id: "words", icon: "📖", text: "Слова" },
  { id: "settings", icon: "⚙️", text: "Настройки" },
] as const;

type Tab = (typeof TABS)[number]["id"];

/** Вкладку можно открыть сразу: …/app/?tab=words. */
function startTab(): Tab {
  const asked = new URLSearchParams(window.location.search).get("tab");
  return TABS.find((t) => t.id === asked)?.id ?? "learn";
}

/** Три вкладки внизу. Карточки при уходе с вкладки закрываются — их нативные кнопки прячутся сами. */
export function App() {
  const [tab, setTab] = useState<Tab>(startTab);
  return (
    <>
      <main className="page">
        {tab === "learn" && <Learn />}
        {tab === "words" && <Words />}
        {tab === "settings" && <SettingsScreen />}
      </main>
      <Tabbar className="tabbar">
        {TABS.map((t) => (
          <Tabbar.Item
            key={t.id}
            text={t.text}
            selected={tab === t.id}
            onClick={() => {
              if (t.id !== tab) haptic.select();
              setTab(t.id);
            }}
          >
            <span className="tab-icon">{t.icon}</span>
          </Tabbar.Item>
        ))}
      </Tabbar>
    </>
  );
}
