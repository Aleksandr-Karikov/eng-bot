import { studyLanguage } from "./language";
import { playAudio, preloadAudio } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { Button, Text, Title } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { useBottomButtons } from "./bottomButtons";
import { transcription, USEFULNESS } from "./format";

/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;

export type DeckAction = "learn" | "know" | "drop";

/** Что показать на карточке колоды: слово и что знаем о нём; audio — путь озвучки без accent (…?word=12 или …?item=5). */
export interface DeckWord {
  term: string;
  translation: string;
  transcriptionUk: string;
  transcriptionUs: string;
  usefulness: number | null;
  context?: string;
  example?: string;
  audio: string;
}

function play(word: DeckWord, accent: "uk" | "us") {
  playAudio(`${word.audio}&accent=${accent}`);
}

/**
 * Карточка колоды «реши про слово»: → знаю, ← учу, ↑ не для меня (кнопками — то же).
 * Перевод скрыт до тапа — сначала честно вспомнить. footer — откуда слово (кто добавил, какой набор).
 */
export function DeckCard({ word: w, footer, onDecide }: { word: DeckWord; footer?: string; onDecide: (a: DeckAction) => void }) {
  const [revealed, setRevealed] = useState(false);
  // Озвучку — заранее, пока человек решает.
  useEffect(() => {
    for (const a of studyLanguage().accents) preloadAudio(`${w.audio}&accent=${a.key}`);
  }, [w.audio]);
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const knowOpacity = useTransform(x, [20, SWIPE_PX], [0, 1]);
  const learnOpacity = useTransform(x, [-SWIPE_PX, -20], [1, 0]);
  const dropOpacity = useTransform(y, [-SWIPE_PX, -20], [1, 0]);

  const fling = useCallback(
    (action: DeckAction) => {
      const to = action === "drop" ? animate(y, -700, { duration: 0.2 }) : animate(x, action === "know" ? 600 : -600, { duration: 0.2 });
      void to.then(() => onDecide(action));
    },
    [x, y, onDecide],
  );
  const know = useCallback(() => fling("know"), [fling]);
  const learn = useCallback(() => fling("learn"), [fling]);
  const native = useBottomButtons({ text: "✅ Знаю", onClick: know }, { text: "📚 Учу", onClick: learn });

  return (
    <div className="deck">
      <motion.div
        className="card triage-card"
        style={{ x, y, rotate }}
        drag
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          const { x: dx, y: dy } = info.offset;
          if (dy < -SWIPE_PX && Math.abs(dy) > Math.abs(dx)) fling("drop");
          else if (dx > SWIPE_PX) fling("know");
          else if (dx < -SWIPE_PX) fling("learn");
        }}
      >
        <motion.div className="stamp stamp-know" style={{ opacity: knowOpacity }}>
          ЗНАЮ
        </motion.div>
        <motion.div className="stamp stamp-forgot" style={{ opacity: learnOpacity }}>
          УЧУ
        </motion.div>
        <motion.div className="stamp stamp-drop" style={{ opacity: dropOpacity }}>
          НЕ ДЛЯ МЕНЯ
        </motion.div>

        <div className="front">
          <Title level="1" weight="2">
            {w.term} {w.usefulness ? USEFULNESS[w.usefulness] : ""}
          </Title>
          {transcription(w) && <Text className="hint">{transcription(w)}</Text>}
          <Text className={`triage-translation${revealed ? "" : " hidden"}`} onClick={() => setRevealed(true)}>
            {revealed ? w.translation : "показать перевод"}
          </Text>
        </div>
        {w.context ? (
          <Text className="block">
            <b>Где встретилось:</b> <i>{w.context}</i>
          </Text>
        ) : (
          revealed &&
          w.example && (
            <Text className="block">
              <b>Пример:</b> <i>{w.example}</i>
            </Text>
          )
        )}
        {footer && <Text className="hint triage-by">{footer}</Text>}
      </motion.div>

      <div className="row">
        <AudioButtons size="m" onPlay={(accent) => void play(w, accent)} />
        <Button mode="plain" size="m" onClick={() => fling("drop")}>
          🙈 Не для меня
        </Button>
      </div>
      <Text className="hint swipe-hint">→ знаю · ← учу · ↑ не для меня</Text>

      {!native && (
        <div className="actions fixed">
          <div className="row">
            <Button mode="gray" size="l" stretched onClick={learn}>
              📚 Учу
            </Button>
            <Button size="l" stretched onClick={know}>
              ✅ Знаю
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
