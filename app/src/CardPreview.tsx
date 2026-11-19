import { Spinner, Text } from "@telegram-apps/telegram-ui";
import { useEffect, useState } from "react";
import { getMe, type Card, type CardView, type VoiceAccent, type WordDetails } from "./api";
import { SwipeCard } from "./SwipeCard";
import { IconClose } from "./icons";

/**
 * Предпросмотр карточки со страницы слова: ровно тот SwipeCard, что в обучении, но без оценок —
 * ответы никуда не уходят. Карточка на нём — собранная из слова, поэтому озвучка и картинка берутся
 * по слову, а не по id карточки: слова может не быть в моих карточках вовсе.
 */
export function CardPreview({ word, onClose }: { word: WordDetails; onClose: () => void }) {
  // Показываем то, что у человека выбрано в настройках карточки: иначе предпросмотр врёт.
  const [settings, setSettings] = useState<{ view?: CardView; voice?: VoiceAccent | null }>();
  useEffect(() => {
    getMe().then(
      (me) => setSettings({ view: me.view, voice: me.voice }),
      // Настройки не пришли — показываем карточку целиком, как SwipeCard по умолчанию.
      () => setSettings({}),
    );
  }, []);

  if (!settings) {
    return (
      <div className="center">
        <Spinner size="l" />
      </div>
    );
  }

  const card: Card = { kind: "card", cardId: word.id, reps: 0, isNew: false, stage: "en_ru", word };
  return (
    <div className="screen preview">
      <header className="top">
        <Text weight="2" className="top-title">
          Карточка при обучении
        </Text>
        <div className="top-right">
          <button className="corner-button" aria-label="Закрыть предпросмотр" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>
      </header>
      <SwipeCard card={card} view={settings.view} voice={settings.voice} onAnswer={() => {}} preview />
    </div>
  );
}
