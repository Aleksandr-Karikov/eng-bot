import { cardAudioPath, playAudio, playAudioIfReady } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { studyLanguage } from "./language";
import { Button, Text } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBottomButtons } from "./bottomButtons";
import { pictureUrl, type Answer, type Card, type CardView, type VoiceAccent } from "./api";
import { transcription, usefulnessIcon } from "./format";
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
    // Успело загрузиться — играем сразу (iOS разрешает play() только в самом нажатии).
    // Не успело — молчим: кнопки озвучки ниже есть всегда, и звук не заиграет сам второй раз.
    if (withVoice && voice) playAudioIfReady(cardAudioPath(card.cardId, voice));
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

        {flipped ? (
          <div className="back">
            {/* Слово слева крупно, перевод справа акцентом: главная пара видна сразу, остальное мельче. */}
            <div className="back-head">
              <div className="back-term">
                <div className="term">
                  {w.term} {usefulnessIcon(w.usefulness)}
                </div>
                <div className="meta">
                  {metaLine(w, view.transcription ? transcription(w) : "")}
                </div>
              </div>
              <div className="back-translation answer">{w.translation}</div>
            </div>

            {/* Родня — сразу под переводом: она важнее запоминалки, поэтому не спрятана. */}
            <WordKin word={w} />

            {w.explanation && !(!enRu && view.explanation && w.meaningHint) && <Text className="block">{w.explanation}</Text>}

            {view.example && w.example && (
              <div>
                <div className="lbl">Пример</div>
                <Text className="block example">
                  <i>{w.example}</i>
                </Text>
              </div>
            )}

            <WordForms word={w} />

            {/* Второстепенное — под аккордеоном: без раскрытия это одна строка, а не абзац. */}
            {view.mnemonic && w.mnemonic && <Fold title="Запоминалка" text={w.mnemonic} />}
            {view.context && w.context && <Fold title="Где встретилось" text={w.context} italic />}

            {/* Место под картинку — заранее, чтобы при загрузке текст не прыгал. */}
            {withPicture && <div className="picture">{picture && <img src={picture} alt="" />}</div>}
          </div>
        ) : (
          <div className="front">
            <div className="term">
              {enRu ? w.term : w.translation} {usefulnessIcon(w.usefulness)}
            </div>
            <div className="meta">{metaLine(w, enRu && view.transcription ? transcription(w) : "")}</div>
            {/* RU → EN: смысл сразу, чтобы среди синонимов было ясно, какое слово спрашивают. */}
            {!enRu && view.explanation && w.meaningHint && <Text className="hint">{w.meaningHint}</Text>}
            <Text className="hint tap">Вспомни {enRu ? "перевод" : studyLanguage().adv} и нажми, чтобы проверить</Text>
          </div>
        )}
      </motion.div>

      {flipped && (
        <div className="row">
          {view.audio && <AudioButtons size="m" onPlay={(accent) => void play(card, accent)} />}
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

/** «транскрипция · часть речи · уровень» — одной строкой, мельче остального: это справка, а не главное. */
function metaLine(w: { partOfSpeech?: string; cefr?: string }, transcriptionText: string): string {
  return [transcriptionText, w.partOfSpeech, w.cefr].filter(Boolean).join(" · ");
}

type Kin = { term: string; translation: string };

/**
 * Синонимы и антонимы рядом, в общей плашке: они нужны при каждом ответе, поэтому видны всегда.
 * Колонки, а не строки подряд — так две группы читаются как сравнение, а не как ещё один список.
 */
function WordKin({ word }: { word: { synonyms?: Kin[]; antonyms?: Kin[] } }) {
  const synonyms = word.synonyms ?? [];
  const antonyms = word.antonyms ?? [];
  if (!synonyms.length && !antonyms.length) return null;
  const list = (items: Kin[]) => items.map((i) => `${i.term} — ${i.translation}`).join("\n");
  return (
    <div className="kin">
      {synonyms.length > 0 && (
        <div>
          <div className="lbl">Синонимы</div>
          <Text className="block small pre">{list(synonyms)}</Text>
        </div>
      )}
      {antonyms.length > 0 && (
        <div>
          <div className="lbl">Антонимы</div>
          <Text className="block small pre">{list(antonyms)}</Text>
        </div>
      )}
    </div>
  );
}

/** Формы — чипами в одну строку: их обычно одна-две, и они не должны занимать абзац. */
function WordForms({ word }: { word: { forms?: Array<{ form: string; label: string }> } }) {
  const forms = word.forms ?? [];
  if (!forms.length) return null;
  return (
    <div className="forms">
      <span className="lbl">Формы</span>
      {forms.map((f) => (
        <span key={f.form} className="chip">
          {f.form}
          {f.label ? ` · ${f.label}` : ""}
        </span>
      ))}
    </div>
  );
}

/** Свёрнутый блок: заголовок в одну строку, содержимое — по тапу. Долгие тексты не растягивают карточку. */
function Fold({ title, text, italic }: { title: string; text: string; italic?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fold">
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen((was) => !was)}>
        <span>{title}</span>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" className={open ? "fold-icon open" : "fold-icon"}>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <Text className={italic ? "block small" : "block"}>
          {italic ? <i>{text}</i> : text}
        </Text>
      )}
    </div>
  );
}
