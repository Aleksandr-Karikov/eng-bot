import { cardAudioPath, playAudio } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { studyLanguage } from "./language";
import { Button, Text, Title } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBottomButtons } from "./bottomButtons";
import { pictureUrl, type Answer, type Card, type CardView, type VoiceAccent } from "./api";
import { transcription, USEFULNESS } from "./format";
/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;

function play(card: Card, accent: VoiceAccent): boolean {
  return playAudio(cardAudioPath(card.cardId, accent));
}

/** Карточка: тап — перевернуть, свайп вправо — «помню», влево — «забыл». Кнопки — то же самое. */
/** Пока настройки не пришли — показываем всё. */
const ALL: CardView = { transcription: true, explanation: true, example: true, context: true, collocations: true, mnemonic: true, audio: true, picture: true };

export function SwipeCard({ card, view = ALL, voice, onAnswer }: { card: Card; view?: CardView; voice?: VoiceAccent | null; onAnswer: (a: Answer) => void }) {
  const [flipped, setFlipped] = useState(false);
  /** Озвучка не успела загрузиться к перевороту — играть без спроса нельзя, показываем кнопку. */
  const [voiceLate, setVoiceLate] = useState(false);
  const [picture, setPicture] = useState<string>();
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const knowOpacity = useTransform(x, [20, SWIPE_PX], [0, 1]);
  const forgotOpacity = useTransform(x, [-SWIPE_PX, -20], [1, 0]);
  const w = card.word;
  const enRu = card.stage === "en_ru";
  const withPicture = w.hasPicture && view.picture;
  const withVoice = Boolean(voice) && view.audio;

  // Картинка грузится сразу при показе карточки (обычно уже подгружена заранее), а не после переворота.
  useEffect(() => {
    if (!withPicture) return;
    let alive = true;
    void pictureUrl(card.cardId).then((url) => alive && setPicture(url));
    return () => {
      alive = false;
    };
  }, [withPicture, card.cardId]);

  const fling = useCallback(
    (answer: Answer, direction: number) => {
      void animate(x, direction * 600, { duration: 0.2 }).then(() => onAnswer(answer));
    },
    [x, onAnswer],
  );
  const good = useCallback(() => fling("good", 1), [fling]);
  const again = useCallback(() => fling("again", -1), [fling]);
  /**
   * Ответ показан — озвучиваем выбранным вариантом, чтобы слово ещё и услышать. Не успели загрузиться —
   * не играем молча, показываем кнопку. Зовётся один раз на карточку: `revealed` закрывает повтор,
   * иначе тап по карточке после кнопки «Показать ответ» играл бы второй раз.
   */
  const revealed = useRef(false);
  const reveal = useCallback(() => {
    if (revealed.current) return;
    revealed.current = true;
    setFlipped(true);
    if (withVoice && voice && !play(card, voice)) setVoiceLate(true);
  }, [card, voice, withVoice]);
  // Главные действия — нативными кнопками Telegram внизу: всегда под пальцем, не уезжают при прокрутке.
  const native = useBottomButtons(
    flipped ? { text: "😎 Помню", onClick: good } : { text: "Показать ответ", onClick: reveal },
    flipped ? { text: "😵 Забыл", onClick: again } : undefined,
  );

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
          else reveal();
        }}
        onClick={reveal}
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
          {enRu && view.transcription && transcription(w) && <Text className="hint">{transcription(w)}</Text>}
          {/* RU → EN: смысл сразу, чтобы среди синонимов было ясно, какое слово спрашивают. */}
          {!enRu && view.explanation && w.meaningHint && <Text className="hint">{w.meaningHint}</Text>}
        </div>

        {flipped ? (
          <div className="back">
            <Title level="2" weight="2" className="answer">
              {enRu ? w.translation : w.term}
            </Title>
            {!enRu && view.transcription && transcription(w) && <Text className="hint">{transcription(w)}</Text>}
            {w.explanation && !(!enRu && view.explanation && w.meaningHint) && <Text className="block">{w.explanation}</Text>}
            {view.example && w.example && (
              <Text className="block">
                <b>Пример:</b> <i>{w.example}</i>
              </Text>
            )}
            {view.context && w.context && (
              <Text className="block">
                <b>Где встретилось:</b> <i>{w.context}</i>
              </Text>
            )}
            {view.mnemonic && w.mnemonic && (
              <Text className="block">
                <b>Как запомнить:</b> {w.mnemonic}
              </Text>
            )}
            {/* Место под картинку — заранее, чтобы при загрузке текст не прыгал. */}
            {withPicture && <div className="picture">{picture && <img src={picture} alt="" />}</div>}
          </div>
        ) : (
          <Text className="hint tap">Вспомни {enRu ? "перевод" : studyLanguage().adv} и нажми, чтобы проверить</Text>
        )}
      </motion.div>

      {flipped && (
        <div className="row">
          {/* Озвучка не успела к перевороту — вместо неё кнопка: включить по своему решению. */}
          {voiceLate ? (
            <Button
              mode="bezeled"
              size="m"
              onClick={() => {
                if (voice) void play(card, voice);
                setVoiceLate(false);
              }}
            >
              🔊 Озвучить
            </Button>
          ) : (
            view.audio && <AudioButtons size="m" onPlay={(accent) => void play(card, accent)} />
          )}
          {card.isNew && (
            <Button mode="plain" size="m" onClick={() => fling("easy", 1)}>
              ✅ Уже знаю
            </Button>
          )}
        </div>
      )}

      {/* Без нативных кнопок (браузер, старый Telegram) — своя панель, закреплённая внизу. */}
      {!native && (
        <div className="actions fixed">
          {flipped ? (
            <div className="row">
              <Button mode="gray" size="l" stretched onClick={again}>
                😵 Забыл
              </Button>
              <Button size="l" stretched onClick={good}>
                😎 Помню
              </Button>
            </div>
          ) : (
            <Button size="l" stretched onClick={reveal}>
              Показать ответ
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
