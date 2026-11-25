import { cardAudioPath, playAudio, playAudioIfReady } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { Button, Text } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBottomButtons } from "./bottomButtons";
import { exampleTranslation, pictureUrl, wordPictureUrl, type CardAnswer, type Card, type CardView, type VoiceAccent } from "./api";
import { transcription } from "./format";
import { IconEye, UsefulDot } from "./icons";
/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;

/**
 * Путь озвучки: у карточки в обучении — по её id, в предпросмотре слова — по слову
 * (карточки у человека может и не быть: слово убрано «не для меня»).
 */
function audioOf(card: Card, accent: VoiceAccent, preview?: boolean): string {
  return preview ? `/api/audio?word=${card.word.id}&accent=${accent}` : cardAudioPath(card.cardId, accent);
}

/** Карточка: тап — перевернуть, свайп вправо — «помню», влево — «забыл». Кнопки — то же самое. */
/** Пока настройки не пришли — показываем всё. */
const ALL: CardView = { transcription: true, explanation: true, example: true, context: true, collocations: true, mnemonic: true, audio: true, picture: true };

export function SwipeCard({
  card,
  view = ALL,
  voice,
  onAnswer,
  preview,
}: {
  card: Card;
  view?: CardView;
  voice?: VoiceAccent | null;
  onAnswer: (a: CardAnswer) => void | Promise<void>;
  /** Предпросмотр со страницы слова: перевернуть можно, оценить нельзя — ответы никуда не уходят. */
  preview?: boolean;
}) {
  const [flipped, setFlipped] = useState(false);
  const [picture, setPicture] = useState<string>();
  // Перевод примера — по тапу: ученик не всегда понимает предложение, и тогда теряется весь смысл примера.
  const [exampleRu, setExampleRu] = useState(card.word.exampleTranslation ?? "");
  const [exampleOpen, setExampleOpen] = useState(false);
  const [exampleBusy, setExampleBusy] = useState(false);
  const deciding = useRef(false);
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-12, 12]);
  const knowOpacity = useTransform(x, [20, SWIPE_PX], [0, 1]);
  const forgotOpacity = useTransform(x, [-SWIPE_PX, -20], [1, 0]);
  const w = card.word;
  const needsDecision = card.needsDecision && !preview;
  const positiveLabel = needsDecision ? "Уже знаю" : "Помню";
  const negativeLabel = needsDecision ? "Учу" : "Забыл";
  const enRu = card.stage === "en_ru";
  const withPicture = w.hasPicture && view.picture;
  const withVoice = Boolean(voice) && view.audio;
  const question = enRu ? w.term : w.translation;
  const answerText = enRu ? w.translation : w.term;

  // Картинка грузится сразу при показе карточки (обычно уже подгружена заранее), а не после переворота.
  useEffect(() => {
    if (!withPicture) return;
    let alive = true;
    void (preview ? wordPictureUrl(w.id) : pictureUrl(card.cardId)).then((url) => alive && setPicture(url));
    return () => {
      alive = false;
    };
  }, [withPicture, card.cardId, w.id, preview]);

  const decide = useCallback(async (answer: CardAnswer) => {
    if (deciding.current) return;
    deciding.current = true;
    try {
      await onAnswer(answer);
    } finally {
      deciding.current = false;
    }
  }, [onAnswer]);
  const fling = useCallback(
    (answer: CardAnswer, direction: number) => {
      if (needsDecision) void decide(answer);
      else void animate(x, direction * 600, { duration: 0.2 }).then(() => void onAnswer(answer));
    },
    [decide, needsDecision, x, onAnswer],
  );
  const good = useCallback(() => fling(needsDecision ? "know" : "good", 1), [fling, needsDecision]);
  const tapExample = useCallback(() => {
    if (exampleOpen) return setExampleOpen(false);
    if (exampleRu) return setExampleOpen(true);
    if (exampleBusy) return;
    setExampleBusy(true);
    void exampleTranslation(card.word.id)
      .then((text) => {
        setExampleRu(text);
        setExampleOpen(Boolean(text));
      })
      .catch(() => {})
      .finally(() => setExampleBusy(false));
  }, [card.word.id, exampleOpen, exampleRu, exampleBusy]);
  const again = useCallback(() => fling("again", -1), [fling]);
  /**
   * Ответ показан — озвучиваем выбранным вариантом, чтобы слово ещё и услышать. Не успели загрузиться —
   * не играем молча, показываем кнопку. Зовётся один раз на карточку: `revealed` закрывает повтор,
   * иначе тап по карточке после кнопки «Показать ответ» играл бы второй раз.
   */
  const revealed = useRef(false);
  const spoiler = useRef<HTMLButtonElement>(null);
  const reveal = useCallback((point?: { clientX: number; clientY: number }) => {
    if (revealed.current) return;
    revealed.current = true;
    if (point && spoiler.current) {
      const { left, top, width, height } = spoiler.current.getBoundingClientRect();
      const originX = Math.max(0, Math.min(width, point.clientX - left));
      const originY = Math.max(0, Math.min(height, point.clientY - top));
      spoiler.current.style.transformOrigin = `${originX}px ${originY}px`;
    }
    setFlipped(true);
    // Успело загрузиться — играем сразу (iOS разрешает play() только в самом нажатии).
    // Не успело — молчим: кнопки озвучки ниже есть всегда, и звук не заиграет сам второй раз.
    if (withVoice && voice) playAudioIfReady(audioOf(card, voice, preview));
  }, [card, voice, withVoice, preview]);
  // Главные действия — нативными кнопками Telegram внизу: всегда под пальцем, не уезжают при прокрутке.
  // В предпросмотре оценивать нечего: пустой вызов прячет нативные кнопки и свою панель не рисует.
  const main = flipped ? { text: positiveLabel, onClick: good } : { text: "Показать ответ", onClick: () => reveal() };
  const native = useBottomButtons(preview ? undefined : main, flipped && !preview ? { text: negativeLabel, onClick: again } : undefined);

  return (
    <div className="deck">
      {/* Штампы «ПОМНЮ/ЗАБЫЛ» — над карточкой, а не внутри: карточка наклоняется под свайпом,
          и место под них больше не отнимается у содержимого. */}
      <motion.div className="stamp stamp-know" style={{ opacity: knowOpacity }}>
        {positiveLabel.toUpperCase()}
      </motion.div>
      <motion.div className="stamp stamp-forgot" style={{ opacity: forgotOpacity }}>
        {negativeLabel.toUpperCase()}
      </motion.div>
      <motion.div
        className="card"
        style={{ x, rotate }}
        drag={flipped && !preview ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_PX) good();
          else if (info.offset.x < -SWIPE_PX) again();
          else reveal();
        }}
        onClick={(event) => reveal(event.detail > 0 ? event : undefined)}
      >
        {/* Полезность — мелким чипом в углу: при заучивании она почти не нужна и не должна спорить со словом. */}
        {/* Штампы «ПОМНЮ/ЗАБЫЛ» живут вне карточки: внутри они занимали её место. */}
        {w.usefulness ? <UsefulDot level={w.usefulness} className="useful-chip" /> : null}
        <div className="card-body">
          <div className="card-head">
            <div className={`term ${sizeOf(question)}`}>{question}</div>
            {/* Транскрипция — только когда вопрос на изучаемом языке. В RU → EN она выдала бы ответ. */}
            <div className="meta">{metaLine(w, enRu && view.transcription ? transcription(w) : "")}</div>
          </div>

          <div className={`card-reveal-zone${flipped ? " is-revealed" : ""}`}>
            <div className="card-reveal-content" hidden={!flipped}>
              <div className={`card-answer ${sizeOf(answerText)}`}>
                <div className="answer">{answerText}</div>
                {!enRu && view.transcription && transcription(w) && (
                  <div className="meta">{transcription(w)}</div>
                )}
              </div>

              <div className="card-rest">
                <WordKin word={w} />

                {w.explanation && !(!enRu && view.explanation && w.meaningHint) && <Text className="block">{w.explanation}</Text>}

                {view.example && w.example && (
                  <div>
                    <div className="lbl">Пример</div>
                    <Text className="block example tap-example" onClick={tapExample}>
                      <i>{w.example}</i>
                    </Text>
                    {exampleBusy && <Text className="block example muted">Перевожу…</Text>}
                    {exampleOpen && exampleRu && <Text className="block example example-ru">{exampleRu}</Text>}
                  </div>
                )}

                <WordForms word={w} />

                {view.mnemonic && w.mnemonic && <Fold title="Запоминалка" text={w.mnemonic} />}
                {view.context && w.context && <Fold title="Где встретилось" text={w.context} italic />}

                {/* Место под картинку — заранее, чтобы при загрузке текст не прыгал. */}
                {withPicture && <div className="picture">{picture && <img src={picture} alt="" />}</div>}
              </div>
            </div>
            <button ref={spoiler} type="button" className="card-spoiler" aria-label="Показать ответ" disabled={flipped} aria-hidden={flipped}>
              <span className="card-spoiler-label">
                <IconEye size={19} />
                Ответ скрыт
              </span>
            </button>
          </div>
        </div>
      </motion.div>

      {flipped && needsDecision && <Text className="hint swipe-hint">Будешь учить это слово?</Text>}
      {flipped && (
        <div className="row">
          {view.audio && <AudioButtons size="m" onPlay={(accent) => void playAudio(audioOf(card, accent, preview))} />}
          {needsDecision ? (
            <Button mode="plain" size="m" onClick={() => void decide("drop")}>
              Не для меня
            </Button>
          ) : card.isNew && !preview && (
            <Button mode="plain" size="m" onClick={() => fling("easy", 1)}>
              Уже знаю
            </Button>
          )}
        </div>
      )}

      {/* Без нативных кнопок (браузер, старый Telegram) — своя панель, закреплённая внизу. */}
      {!native && !preview && (
        <div className="actions fixed">
          {flipped ? (
            <div className="row">
              <Button mode="gray" size="l" stretched onClick={again}>
                {negativeLabel}
              </Button>
              <Button size="l" stretched onClick={good}>
                {positiveLabel}
              </Button>
            </div>
          ) : (
            <Button size="l" stretched onClick={() => reveal()}>
              Показать ответ
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Размер текста по длине: словами бывают и `mantelpiece`, и `something of a niggle regarding our business
 * dealings` (53 символа). Кегль подбирается по длине, а не обрезается — иначе текст уезжал за край карточки.
 * Классы, а не инлайн-стиль: правило в CSS рядом с остальными размерами карточки.
 */
function sizeOf(text: string): string {
  const len = text.trim().length;
  if (len > 28) return "size-xs";
  if (len > 16) return "size-s";
  return "size-m";
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

/**
 * Открытые блоки помним на устройстве по заголовку: кто привык читать запоминалку каждый раз,
 * не должен раскрывать её заново на каждой карточке. Ключ общий для всех слов — состояние
 * привязано к виду сведений, а не к слову.
 */
const FOLD_KEY = "wordboss-card-folds";

function savedFolds(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(FOLD_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : undefined;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function rememberFold(title: string, open: boolean): void {
  try {
    localStorage.setItem(FOLD_KEY, JSON.stringify({ ...savedFolds(), [title]: open }));
  } catch {
    // хранилище недоступно — блок просто не запомнится
  }
}

/** Свёрнутый блок: заголовок в одну строку, содержимое — по тапу. Долгие тексты не растягивают карточку. */
function Fold({ title, text, italic }: { title: string; text: string; italic?: boolean }) {
  const [open, setOpen] = useState(() => savedFolds()[title] ?? false);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    rememberFold(title, next);
  };
  return (
    <div className="fold">
      <button type="button" className="fold-head" aria-expanded={open} onClick={toggle}>
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
