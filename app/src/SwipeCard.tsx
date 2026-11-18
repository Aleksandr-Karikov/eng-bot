import { cardAudioPath, playAudio, playAudioIfReady } from "./sound";
import { AudioButtons } from "./AudioButtons";
import { studyLanguage } from "./language";
import { Button, Text } from "@telegram-apps/telegram-ui";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBottomButtons } from "./bottomButtons";
import { pictureUrl, wordPictureUrl, type Answer, type Card, type CardView, type VoiceAccent } from "./api";
import { transcription, usefulnessIcon } from "./format";
/** Насколько протянуть карточку, чтобы засчитать свайп. */
const SWIPE_PX = 110;

/**
 * Путь озвучки: у карточки в обучении — по её id, в предпросмотре слова — по слову
 * (карточки у человека может и не быть: слово убрано «🙈 не для меня»).
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
  onAnswer: (a: Answer) => void;
  /** Предпросмотр со страницы слова: перевернуть можно, оценить нельзя — ответы никуда не уходят. */
  preview?: boolean;
}) {
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
    if (withVoice && voice) playAudioIfReady(audioOf(card, voice, preview));
  }, [card, voice, withVoice, preview]);
  // Главные действия — нативными кнопками Telegram внизу: всегда под пальцем, не уезжают при прокрутке.
  // В предпросмотре оценивать нечего: пустой вызов прячет нативные кнопки и свою панель не рисует.
  const main = flipped ? { text: "😎 Помню", onClick: good } : { text: "Показать ответ", onClick: reveal };
  const native = useBottomButtons(preview ? undefined : main, flipped && !preview ? { text: "😵 Забыл", onClick: again } : undefined);

  return (
    <div className="deck">
      {/* Штампы «ПОМНЮ/ЗАБЫЛ» — над карточкой, а не внутри: карточка наклоняется под свайпом,
          и место под них больше не отнимается у содержимого. */}
      <motion.div className="stamp stamp-know" style={{ opacity: knowOpacity }}>
        ПОМНЮ
      </motion.div>
      <motion.div className="stamp stamp-forgot" style={{ opacity: forgotOpacity }}>
        ЗАБЫЛ
      </motion.div>
      <motion.div
        className="card"
        style={{ x, rotate }}
        drag={flipped && !preview ? "x" : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.9}
        onDragEnd={(_, info) => {
          if (info.offset.x > SWIPE_PX) fling("good", 1);
          else if (info.offset.x < -SWIPE_PX) fling("again", -1);
          else reveal();
        }}
        onClick={reveal}
      >
        {/* Полезность — мелким чипом в углу: при заучивании она почти не нужна и не должна спорить со словом. */}
        {/* Штампы «ПОМНЮ/ЗАБЫЛ» живут вне карточки: внутри они занимали её место. */}
        {w.usefulness ? <span className="useful-chip" title={`Полезность: ${w.usefulness} из 3`}>{usefulnessIcon(w.usefulness)}</span> : null}
        {/* Карточка свёрстана целиком сразу: ответ просто не виден, пока не открыт. При открытии ничего
            не сдвигается — ни слово, ни блоки под ним, — поэтому нет прыжка и переноса на две строки. */}
        <div className="card-body">
          <div className="card-head">
            <div className={`term ${sizeOf(question)}`}>{question}</div>
            {/* Транскрипция — только когда вопрос на изучаемом языке. В RU → EN она выдала бы ответ. */}
            <div className="meta">{metaLine(w, enRu && view.transcription ? transcription(w) : "")}</div>
            {/* Ответ всегда под словом, влево: в одну строку со словом он не помещался и переносился.
                До открытия настоящий текст скрыт, но держит место, а поверх лежит размытая подделка:
                так и высота не меняется, и по форме пятна ответ не угадать. */}
            <div className={`card-answer ${sizeOf(answerText)}`} aria-hidden={!flipped}>
              <div className="answer" style={flipped ? undefined : HIDDEN}>{answerText}</div>
              {!enRu && view.transcription && transcription(w) && (
                <div className="meta" style={flipped ? undefined : HIDDEN}>{transcription(w)}</div>
              )}
              {!flipped && <div className="answer fake" aria-hidden="true">{fakeText(answerText)}</div>}
            </div>
          </div>

          <div className={`card-rest${flipped ? "" : " veiled"}`} aria-hidden={!flipped}>
            {/* Родня — сразу под ответом: она важнее запоминалки, поэтому не спрятана. */}
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
        </div>

        {/* Подсказка висит поверх низа карточки: в потоке она сдвигала бы содержимое при открытии. */}
        {!flipped && (
          <Text className="hint tap">Вспомни {enRu ? "перевод" : studyLanguage().adv} и нажми, чтобы проверить</Text>
        )}
      </motion.div>

      {flipped && (
        <div className="row">
          {view.audio && <AudioButtons size="m" onPlay={(accent) => void playAudio(audioOf(card, accent, preview))} />}
          {card.isNew && !preview && (
            <Button mode="plain" size="m" onClick={() => fling("easy", 1)}>
              ✅ Уже знаю
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

/**
 * Псевдотекст той же длины, что и ответ, но из чужих букв: под блюром он держит форму строки,
 * а угадать по нему настоящий ответ нельзя. Детерминированный — иначе мигал бы на каждом рендере.
 */
function fakeText(text: string): string {
  const ALPHABET = "abcdefghijklmnopqrstuvwxyz";
  let seed = 0;
  for (const ch of text) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let out = "";
  for (const ch of text) {
    if (!ch.trim()) {
      out += ch;
      continue;
    }
    seed = (seed * 1103515245 + 12345) >>> 0;
    out += ALPHABET[seed % ALPHABET.length];
  }
  return out;
}

/** Прячем текст, не убирая его из потока: высота остаётся прежней, прыжка нет. */
const HIDDEN = { visibility: "hidden" } as const;

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
