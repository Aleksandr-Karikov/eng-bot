import { Button, Text, Title } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useEffect, useState } from "react";
import { mediaUrl, type Answer, type Card } from "./api";

const USEFULNESS = { 3: "🟢", 2: "🟡", 1: "⚪️" } as Record<number, string>;
/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;

function transcription(w: Card["word"]): string {
  const uk = w.transcriptionUk.trim();
  const us = w.transcriptionUs.trim();
  if (uk && uk === us) return uk;
  return [uk && `🇬🇧 ${uk}`, us && `🇺🇸 ${us}`].filter(Boolean).join("  ·  ");
}

async function play(card: Card, accent: "uk" | "us") {
  const url = await mediaUrl(`/api/audio?card=${card.cardId}&accent=${accent}`);
  if (url) void new Audio(url).play().catch(() => {});
}

/** Карточка: тап — перевернуть, свайп вправо — «помню», влево — «забыл». Кнопки — то же самое. */
export function SwipeCard({ card, onAnswer }: { card: Card; onAnswer: (a: Answer) => void }) {
  const [flipped, setFlipped] = useState(false);
  const [picture, setPicture] = useState<string>();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const knowOpacity = useTransform(x, [20, SWIPE_PX], [0, 1]);
  const forgotOpacity = useTransform(x, [-SWIPE_PX, -20], [1, 0]);
  const w = card.word;
  const enRu = card.stage === "en_ru";

  useEffect(() => {
    if (!flipped || !w.hasPicture || picture) return;
    void mediaUrl(`/api/picture?card=${card.cardId}`).then(setPicture);
  }, [flipped, w.hasPicture, picture, card.cardId]);

  const fling = (answer: Answer, direction: number) => {
    void animate(x, direction * 600, { duration: 0.2 }).then(() => onAnswer(answer));
  };

  return (
    <div className="deck">
      <motion.div
        className="card"
        style={{ x, rotate }}
        drag={flipped ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_PX) fling("good", 1);
          else if (info.offset.x < -SWIPE_PX) fling("again", -1);
        }}
        onClick={() => setFlipped(true)}
      >
        <motion.div className="stamp stamp-know" style={{ opacity: knowOpacity }}>
          ПОМНЮ
        </motion.div>
        <motion.div className="stamp stamp-forgot" style={{ opacity: forgotOpacity }}>
          ЗАБЫЛ
        </motion.div>

        <div className="front">
          <Title level="1" weight="2">
            {enRu ? w.term : w.translation} {w.usefulness ? USEFULNESS[w.usefulness] : ""}
          </Title>
          {enRu && transcription(w) && <Text className="hint">{transcription(w)}</Text>}
        </div>

        {flipped ? (
          <div className="back">
            <Title level="2" weight="2" className="answer">
              {enRu ? w.translation : w.term}
            </Title>
            {!enRu && transcription(w) && <Text className="hint">{transcription(w)}</Text>}
            {picture && <img className="picture" src={picture} alt="" />}
            {w.explanation && <Text className="block">{w.explanation}</Text>}
            {w.example && (
              <Text className="block">
                <b>Пример:</b> <i>{w.example}</i>
              </Text>
            )}
            {w.context && (
              <Text className="block">
                <b>Где встретилось:</b> <i>{w.context}</i>
              </Text>
            )}
            {w.mnemonic && (
              <Text className="block">
                <b>Как запомнить:</b> {w.mnemonic}
              </Text>
            )}
          </div>
        ) : (
          <Text className="hint tap">Вспомни {enRu ? "перевод" : "по-английски"} и нажми, чтобы проверить</Text>
        )}
      </motion.div>

      {flipped ? (
        <div className="actions">
          <div className="row">
            <Button mode="bezeled" size="m" onClick={() => void play(card, "uk")}>
              🔊 UK
            </Button>
            <Button mode="bezeled" size="m" onClick={() => void play(card, "us")}>
              🔊 US
            </Button>
          </div>
          <div className="row">
            <Button mode="gray" size="l" stretched onClick={() => fling("again", -1)}>
              😵 Забыл
            </Button>
            <Button size="l" stretched onClick={() => fling("good", 1)}>
              😎 Помню
            </Button>
          </div>
          {card.isNew && (
            <Button mode="plain" size="m" stretched onClick={() => fling("easy", 1)}>
              ✅ Уже знаю
            </Button>
          )}
        </div>
      ) : (
        <div className="actions">
          <Button size="l" stretched onClick={() => setFlipped(true)}>
            Показать ответ
          </Button>
        </div>
      )}
    </div>
  );
}
