import { getMe, reportTimezone } from "./api";
import { setStudyLanguage } from "./language";

import { settingsButton } from "@telegram-apps/sdk-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { BossScreen } from "./Boss";
import { Grammar } from "./Grammar";
import { Learn } from "./Learn";
import { ProgressScreen } from "./Progress";
import { Sets } from "./Sets";
import { SettingsScreen } from "./Settings";
import { Words } from "./Words";
import { WordGuessScreen } from "./WordGuess";
import { TranslateScreen } from "./Translate";
import { DailyTasksScreen } from "./DailyTasks";
import { IconBook, IconChart, IconChat, IconClose, IconGrammar, IconMenu, IconSettings, IconShield, IconTasks, IconTranslate } from "./icons";
import { haptic } from "./telegram";

type Page = "learn" | "words" | "learning" | "settings" | "progress" | "sets" | "boss" | "grammar" | "word-guess" | "translate" | "daily-tasks";

/** Страницу можно открыть сразу: …/app/?tab=words. */
function startPage(): Page {
  const asked = new URLSearchParams(window.location.search).get("tab");
  const pages: Page[] = ["words", "learning", "settings", "progress", "sets", "boss", "grammar", "word-guess", "translate", "daily-tasks"];
  return pages.find((p) => p === asked) ?? "learn";
}

/**
 * Главное — карточки на весь экран. Слова и настройки — отдельные страницы: они в меню ☰ в углу,
 * настройки ещё и из штатного меню Telegram (⋮ → «Настройки»); назад — нативной кнопкой «Назад».
 */
export function App() {
  const [page, setPage] = useState<Page>(startPage);
  const [limitsBack, setLimitsBack] = useState<"learn" | "learning">();
  const [keepResult, setKeepResult] = useState(false);
  const [backToTasks, setBackToTasks] = useState(false);
  /** Набор, который надо открыть сразу: заполняет пустой `/learn`, когда у человека нет слов. */
  const [startSetId, setStartSetId] = useState<number>();
  const open = useCallback((next: Page, returnFromLimits?: "learn" | "learning", returnToResult = false) => {
    haptic.select();
    if (page === "learn") setKeepResult(returnToResult);
    setLimitsBack(returnFromLimits);
    setPage(next);
  }, [page]);
  /** `setId` — открыть конкретный набор, а не список: так кнопка новичка ведёт прямо в A1. */
  const openSets = useCallback((setId?: number) => {
    setStartSetId(setId);
    open("sets");
  }, [open]);
  const back = useCallback(() => {
    setPage(backToTasks ? "daily-tasks" : "learn");
    setBackToTasks(false);
  }, [backToTasks]);
  // Изучаемый язык нужен и страницам, открытым сразу по ссылке (?tab=), не только карточкам.
  const [, setLanguageLoaded] = useState(false);
  /** Режим босса включён. Пока не знаем — считаем выключенным: лишняя кнопка хуже, чем её отсутствие на секунду. */
  const [bossOn, setBossOn] = useState(false);
  useEffect(() => {
    // Пояс телефона — до запроса данных: от него зависят границы недели босса, и лучше, чтобы сервер
    // узнал его раньше, чем посчитает HP. Ошибку глотаем — это фон, а не действие человека.
    reportTimezone();
    getMe()
      .then((me) => {
        setStudyLanguage(me.language);
        setBossOn(Boolean(me.boss));
        setLanguageLoaded(true);
      })
      .catch(() => {});
  }, [page]);

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

  return (
    <>
      {(page === "learn" || keepResult) && <Learn
        visible={page === "learn"}
        onSets={openSets}
        onSettings={() => open("settings", "learn", true)}
        onBoss={() => open("boss", undefined, true)}
        onLearning={() => open("learning", undefined, true)}
        onDaily={() => open("daily-tasks", undefined, true)}
        corner={
          // Переходы между экранами — в одно меню: четыре отдельных кнопки в углу отнимали место у карточки,
          // а по отдельности они не действия, а навигация.
          <CornerMenu
            items={[
              ...(bossOn ? [{ icon: <IconShield size={16} />, label: "Босс недели", onPick: () => open("boss") }] : []),
              { icon: <IconTasks size={16} />, label: "Задания на день", onPick: () => open("daily-tasks") },
              { icon: <IconChat size={16} />, label: "Объясни слово", onPick: () => open("word-guess") },
              { icon: <IconTranslate size={16} />, label: "Перевод", onPick: () => open("translate") },
              { icon: <IconChart size={16} />, label: "Прогресс", onPick: () => open("progress") },
              // У «Грамматики» своя иконка: книга — это «Слова», и два одинаковых пункта меню
              // различались только подписью.
              { icon: <IconGrammar size={16} />, label: "Грамматика", onPick: () => open("grammar") },
              { icon: <IconBook size={16} />, label: "Слова", onPick: () => open("words") },
              { icon: <IconSettings size={16} />, label: "Настройки", onPick: () => open("settings") },
            ]}
          />
        }
      />}
      {(page === "words" || page === "learning") && <Words initialFilter={page === "learning" ? "learning" : "all"}
        onExit={back} onSets={() => openSets()} onSettings={() => open("settings", "learning")} />}
      {page === "settings" && <SettingsScreen limitsFirst={limitsBack !== undefined} onExit={() => setPage(limitsBack ?? "learn")} />}
      {page === "progress" && <ProgressScreen onExit={back} />}
      {page === "sets" && <Sets onExit={back} startSetId={startSetId} />}
      {page === "boss" && <BossScreen onExit={back} />}
      {page === "grammar" && <Grammar onExit={back} />}
      {page === "word-guess" && <WordGuessScreen onExit={back} />}
      {page === "translate" && <TranslateScreen onExit={back} />}
      {page === "daily-tasks" && <DailyTasksScreen onExit={back} onOpen={(task) => {
        setBackToTasks(task !== "cards");
        open(task === "cards" ? "learn" : task === "explain" ? "word-guess" : task);
      }} />}
    </>
  );
}

/**
 * ☰ Угол экрана: одно меню вместо стопки кнопок.
 *
 * Навигация в шапке competes с карточкой за место: до появления босса хватало двух иконок,
 * а с прогрессом и боссом их стало четыре, и название комнаты сжималось в «…». Действия с самой
 * карточкой (отменить, исправить, разобрать) остаются в шапке — они нужны в один тап, а выбор раздела нет.
 */
function CornerMenu({ items }: { items: Array<{ icon: ReactNode; label: string; onPick: () => void }> }) {
  const [open, setOpen] = useState(false);
  const pick = (item: { onPick: () => void }) => {
    haptic.select();
    setOpen(false);
    item.onPick();
  };
  return (
    <div className="corner-menu">
      <button className="corner-button" aria-label="Меню" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <IconClose size={18} /> : <IconMenu size={18} />}
      </button>
      {open && (
        <>
          {/* Тап мимо меню закрывает его — иначе оно висит над карточкой. */}
          <div className="corner-scrim" onClick={() => setOpen(false)} />
          <div className="corner-list">
            {items.map((item) => (
              <button key={item.label} className="corner-item" onClick={() => pick(item)}>
                <span className="corner-item-icon" aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
