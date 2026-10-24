import { z } from "zod";
import { capStem, EN, type Language } from "../lang";
import { fixesField, jsonArray, jsonObject } from "./json";

export interface Enrichment {
  /** Английский вариант, если спросили русское слово (/add зуб → tooth); иначе нет. */
  term?: string;
  translation: string;
  explanation: string;
  example: string;
  /** IPA в британском и американском произношении, например "/bæŋk/"; "" если Claude не дал. */
  transcriptionUk?: string;
  transcriptionUs?: string;
  /** Запоминалка: созвучие или образ, связывающий слово со значением. */
  mnemonic?: string;
  /** Факты о слове для оценки полезности (её считает код — services/usefulness). */
  sense?: Sense;
  register?: Register;
  /** Только для фраз из нескольких слов. */
  phraseFrequency?: PhraseFrequency;
  /** Итог оценки — заполняет rateUsefulness, не модель: 3 — очень полезное, 2 — полезное, 1 — необязательное. */
  usefulness?: number;
  usefulnessNote?: string;
}

export const SENSES = ["main", "secondary", "rare"] as const;
export const REGISTERS = ["neutral", "informal", "formal", "rude", "dated", "niche"] as const;
export const PHRASE_FREQUENCIES = ["common", "occasional", "rare"] as const;
export type Sense = (typeof SENSES)[number];
export type Register = (typeof REGISTERS)[number];
export type PhraseFrequency = (typeof PHRASE_FREQUENCIES)[number];

/** Перечисление от модели: регистр и пробелы не важны, незнакомое — как не указано. */
const choice = <T extends readonly string[]>(values: T) =>
  z
    .string()
    .trim()
    .toLowerCase()
    .transform((v) => ((values as readonly string[]).includes(v) ? (v as T[number]) : undefined))
    .optional()
    .catch(undefined);

export interface ExtractedItem extends Enrichment {
  term: string;
  /** Предложение из текста, где встретилось; "" для списка слов. */
  context?: string;
}

export interface CheckResult {
  /** Исправленный текст; изменённые места обёрнуты в **…**. Если ошибок нет — исходный текст. */
  corrected: string;
  /** category — тип ошибки по-русски («времена: Present Continuous вместо Future Simple»), для профиля слабых мест. */
  /** slip — описка (опечатка, пропущенная буква, чатовое сокращение), а не пробел в знаниях: в профиль не идёт. */
  fixes: Array<{ wrong: string; right: string; why: string; category?: string; slip?: boolean }>;
  /** Вариант, который звучит естественнее, или "" если и так нормально. */
  natural: string;
}

/** Предыдущее сообщение чата — для понимания, что и почему, а не для исправления. */
export interface ContextMessage {
  author: string;
  text: string;
}

/** Картинка для Claude (скриншот, фото страницы). */
export interface ImageInput {
  data: Buffer;
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export interface WordEnricher {
  /** context — реплика, где встретилось: перевод и объяснение — именно в этом значении. */
  enrich(term: string, translationHint?: string, context?: string): Promise<Enrichment>;
  /** Выделяет из текста или списка слова и фразы, полезные для изучения, сразу с переводом. */
  extract(text: string): Promise<ExtractedItem[]>;
  /** То же для скриншота или фото страницы; note — подпись пользователя к картинке. */
  extractImage(image: ImageInput, note?: string): Promise<ExtractedItem[]>;
  /** Английский текст с картинки дословно, построчно ("" — текста нет): для области экрана из расширения. */
  readImage?(image: ImageInput): Promise<string>;
  /** Проверяет английский текст: ошибки обязательно, «как естественнее» — отдельно. */
  /** leadIn — предыдущие сообщения того же автора, которые проверяемое продолжает (одна реплика). */
  check(text: string, context?: ContextMessage[], author?: string, leadIn?: string[]): Promise<CheckResult>;
}

/** В клавиатуре пачки слова листаются страницами, так что 100 пунктов укладываются в лимит кнопок Telegram. */
export const MAX_EXTRACT = 100;

const enrichmentFields = {
  translation: z.string().trim().min(1),
  explanation: z.string().trim().default(""),
  example: z.string().trim().default(""),
  transcription_uk: z.string().trim().default(""),
  transcription_us: z.string().trim().default(""),
  mnemonic: z.string().trim().default(""),
  sense: choice(SENSES),
  register: choice(REGISTERS),
  phrase_frequency: choice(PHRASE_FREQUENCIES),
};

const toEnrichment = <T extends { transcription_uk: string; transcription_us: string; phrase_frequency?: PhraseFrequency }>({
  transcription_uk,
  transcription_us,
  phrase_frequency,
  ...rest
}: T) => ({ ...rest, transcriptionUk: transcription_uk, transcriptionUs: transcription_us, phraseFrequency: phrase_frequency });

const enrichmentSchema = z
  .object({ ...enrichmentFields, term: z.string().trim().optional() })
  .transform(({ term, ...rest }) => ({ ...toEnrichment(rest), ...(term ? { term } : {}) }));

/** Русское слово без букв изучаемого языка: человек спрашивает «как это по-английски». */
export const isRussian = (text: string, lang: Language = EN) => /[а-яё]/i.test(text) && !lang.script.test(text);

/**
 * Факты о слове для оценки полезности. Итог («полезно ли») модель не ставит — это субъективно и прыгает;
 * она отвечает на конкретные вопросы с вариантами, а оценку по правилам считает код (services/usefulness).
 */
export const USEFULNESS_HINT = [
  "sense — в каком значении дано слово (смотри на перевод): main — основное, самое частое; secondary — обычное, но не главное;",
  "rare — редкое, узкое или сленговое значение этого слова (как divine в значении «восхитительно»);",
  "register — neutral; informal — разговорное; formal — книжное или официальное; rude — грубое, ругательство;",
  "dated — устаревшее; niche — жаргон узкой сферы или придумка конкретного сериала;",
  "phrase_frequency — только для фраз и идиом из нескольких слов: как часто их реально говорят —",
  "common (как pay off, run late, call it a day), occasional (как keep plates spinning, tongue-tied, steady paycheck),",
  "rare (как trump the kipper, snag yourself a peerage); для одного слова — пустая строка.",
].join("\n");

/** Для корейского — те же вопросы, но примеры фраз английские сбили бы модель: без них. */
const USEFULNESS_HINT_PLAIN = [
  "sense — в каком значении дано слово (смотри на перевод): main — основное, самое частое; secondary — обычное, но не главное;",
  "rare — редкое, узкое или сленговое значение этого слова;",
  "register — neutral; informal — разговорное; formal — книжное или официальное; rude — грубое, ругательство;",
  "dated — устаревшее; niche — жаргон узкой сферы или придумка конкретного сериала;",
  "phrase_frequency — только для фраз и устойчивых выражений из нескольких слов: как часто их реально говорят —",
  "common, occasional или rare; для одного слова — пустая строка.",
].join("\n");

const usefulnessHint = (lang: Language) => (lang.code === "en" ? USEFULNESS_HINT : USEFULNESS_HINT_PLAIN);

const TRANSCRIPTION_HINT =
  "transcription_uk и transcription_us — транскрипция IPA в британском (RP) и американском произношении в слешах, для фразы — целиком.";

/** Корейский: вместо IPA — романизация (слот transcription_uk), второго произношения нет. */
const TRANSCRIPTION_HINT_KO =
  "transcription_uk — романизация словарной формы (term) по системе Revised Romanization, по слогам через дефис (사랑 → sa-rang), для фразы — целиком; transcription_us — пустая строка.";

const transcriptionHint = (lang: Language) => (lang.code === "en" ? TRANSCRIPTION_HINT : TRANSCRIPTION_HINT_KO);

export const SYSTEM_PROMPT =
  "Ты помогаешь русскоязычным людям учить английский. Отвечай строго одним JSON-объектом, без пояснений и без markdown.";

export function systemPrompt(lang: Language = EN): string {
  return SYSTEM_PROMPT.replace("английск", lang.stem);
}

export function buildPrompt(term: string, translationHint?: string, context?: string, lang: Language = EN): string {
  const russian = isRussian(term, lang);
  return [
    russian
      ? `Русское слово или фраза: "${term}". Подбери самый употребительный ${lang.stem}ий эквивалент (слово или устойчивое выражение) и опиши его — всё ниже про ${lang.stem}ий вариант.`
      : `${capStem(lang)}ое слово или фраза: "${term}".`,
    translationHint ? `Пользователь имеет в виду значение "${translationHint}" — опиши именно его.` : "",
    context
      ? `Встретилось в реплике: "${context}". Переводи и объясняй в значении из этой реплики; словарную форму не меняй.`
      : "",
    // Корейское слово из текста часто приходит с частицей или в спряжении (책을, 갔어요) — описываем словарную форму.
    !russian && lang.code === "ko" ? 'Если слово дано с частицей или в спряжённой форме, опиши его словарную форму и верни её в поле "term".' : "",
    russian
      ? `Верни JSON: {"term": "...", "translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "...", "sense": "main", "register": "neutral", "phrase_frequency": ""}, где term — этот ${lang.stem}ий эквивалент,`
      : lang.code === "ko"
        ? 'Верни JSON: {"term": "...", "translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "...", "sense": "main", "register": "neutral", "phrase_frequency": ""}, где term — словарная форма,'
        : 'Верни JSON: {"translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "...", "sense": "main", "register": "neutral", "phrase_frequency": ""}, где',
    "translation — краткий перевод на русский (1–3 самых частых значения через запятую),",
    "explanation — объяснение значения на русском в одном предложении,",
    `example — короткое естественное предложение на ${lang.stem}ом с этим словом,`,
    transcriptionHint(lang),
    usefulnessHint(lang),
  ]
    .filter(Boolean)
    .join("\n");
}

export function parseEnrichment(text: string): Enrichment {
  return enrichmentSchema.parse(jsonObject(text));
}

const extractedItemSchema = z
  .object({ ...enrichmentFields, term: z.string().trim().min(1), context: z.string().trim().default("") })
  .transform(toEnrichment);

export function buildExtractPrompt(text: string, lang: Language = EN): string {
  return [
    `Ниже ${lang.stem}ий текст ИЛИ список слов и фраз, которые пользователь выписал сам. Определи, что это.`,
    ...extractRules(lang),
    "",
    "Текст:",
    text,
  ].join("\n");
}

/** Для картинки: сначала прочитать, потом те же правила. */
export function buildExtractImagePrompt(note?: string, lang: Language = EN): string {
  return [
    `На картинке — ${lang.stem}ий текст (скриншот, фото страницы, субтитры, переписка) ИЛИ список слов и фраз. Прочитай его и определи, что это.`,
    "Интерфейс приложений, имена, время и прочий мусор вокруг текста игнорируй.",
    ...extractRules(lang),
    note ? `\nПодпись пользователя к картинке (учти, если это пожелание): ${note}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildReadImagePrompt(lang: Language = EN): string {
  return [
    "На картинке — кусок экрана: кадр видео с субтитрами, картинка, скан, мем или страница.",
    `Перепиши весь ${lang.stem}ий текст с неё дословно, сохраняя порядок и деление на строки. Ничего не переводи и не объясняй.`,
    "Кнопки интерфейса, время, счётчики и прочий мусор вокруг основного текста пропусти.",
    `Верни только сам текст, без кавычек и пояснений. Если ${lang.stem}ого текста нет — верни пустую строку.`,
  ].join("\n");
}

const extractRules = (lang: Language) => [
  "Строки могут начинаться с префикса экспорта чата вроде «[14/10/2026 21:31] Имя:» — это не часть фразы, игнорируй его.",
  "Если это список (по пункту на строку) — возьми каждый пункт, ничего не пропускай и не сокращай фразу до одного слова;",
  ...(lang.code === "en"
    ? [
        "глагольную форму можно привести к начальной (snagging yourself a peerage → snag yourself a peerage), но смысл фразы сохрани.",
        "Если это связный текст — выдели то, что стоит выучить русскоязычному человеку: фразовые глаголы, идиомы,",
        "устойчивые выражения и не самые базовые слова, пропусти очевидное (the, is, go, имена собственные).",
      ]
    : [
        "слова с частицами и окончаниями приводи к словарной форме (책을 → 책, 갔어요 → 가다), но смысл фразы сохрани.",
        "Если это связный текст — выдели то, что стоит выучить русскоязычному человеку: полезные слова, устойчивые выражения",
        "и разговорные конструкции, пропусти совсем базовое (이, 가, 은, 는, 하다, имена собственные). Слова — в словарной форме.",
      ]),
  `Не больше ${MAX_EXTRACT} пунктов, без повторов.`,
  'Верни JSON-массив: [{"term": "...", "translation": "...", "explanation": "...", "example": "...", "transcription_uk": "...", "transcription_us": "...", "context": "...", "sense": "main", "register": "neutral", "phrase_frequency": ""}], где',
  "translation — краткий перевод на русский в значении из текста, explanation — одно предложение на русском,",
  `example — короткое предложение на ${lang.stem}ом,`,
  transcriptionHint(lang),
  usefulnessHint(lang),
  "context — предложение из текста, где оно встретилось, дословно (если длинное — только нужная часть, до 200 символов); для списка слов — пустая строка.",
];

/** Невалидные пункты отбрасываются; если в ответе вообще нет массива — бросает. */
export function parseExtraction(text: string): ExtractedItem[] {
  return jsonArray(text)
    .map((entry) => extractedItemSchema.safeParse(entry))
    .flatMap((r) => (r.success ? [r.data] : []))
    .slice(0, MAX_EXTRACT);
}

const checkSchema = z.object({
  corrected: z.string(),
  fixes: fixesField,
  natural: z.string().trim().default(""),
});

/** Крупные темы ошибок — чтобы одинаковые ошибки складывались в одну строку профиля. */
export const MISTAKE_CATEGORIES = [
  "времена",
  "формы глаголов",
  "артикли",
  "предлоги",
  "порядок слов",
  "согласование",
  "множественное число",
  "модальные глаголы",
  "выбор слова",
  "орфография",
  "другое",
];

/** Темы ошибок в корейском: артиклей и предлогов нет, зато частицы, спряжение и вежливость. */
export const MISTAKE_CATEGORIES_KO = [
  "частицы",
  "окончания и спряжение",
  "вежливость и стиль речи",
  "времена",
  "порядок слов",
  "выбор слова",
  "орфография",
  "другое",
];

export const mistakeCategories = (lang: Language = EN) => (lang.code === "en" ? MISTAKE_CATEGORIES : MISTAKE_CATEGORIES_KO);

export function buildCheckPrompt(text: string, context: ContextMessage[] = [], author?: string, leadIn: string[] = [], lang: Language = EN): string {
  const contextLines = context.length
    ? [
        "Предыдущие сообщения чата — только контекст, их не исправляй. Используй их, чтобы понять смысл и объяснить, почему нужно именно так:",
        ...context.map((m) => `${m.author}: ${m.text}`),
        "",
      ]
    : [];
  return [
    ...contextLines,
    `Проверь ${lang.stem}ий текст, который написал русскоязычный человек.`,
    "1) Исправь все грамматические, орфографические и лексические ошибки. Не трогай то, что и так правильно.",
    `2) Если фраза звучит не по-${lang.stem}и (калька с русского, странный порядок слов, неуместное слово), предложи вариант естественнее.`,
    ...(lang.code === "en"
      ? [
          "Не предлагай его ради мелочей — сокращений вроде we're, синонимов, «a bit» вместо «a little bit». Если фраза и так звучит нормально, оставь пустую строку.",
          "Пунктуацию и регистр в разговорных сообщениях не считай ошибкой, если смысл не страдает.",
          "Это переписка в чате: общепринятые сокращения и сленг (thx, ty, pls, u, btw, gonna) — не ошибка.",
          "Если слово похоже на опечатку или сокращение, выбирай вариант по смыслу сообщения и разговора, а не ближайший по написанию:",
          "например, «ths» в ответ на пожелание — это thx (thanks), а не this.",
        ]
      : [
          "Не предлагай его ради мелочей — синонимов или другой, но тоже уместной формы. Если фраза и так звучит нормально, оставь пустую строку.",
          "Пунктуацию и пробелы между словами в разговорных сообщениях не считай ошибкой, если смысл не страдает.",
          "Это переписка в чате: общепринятые сокращения и сленг (ㅋㅋ, ㅎㅎ, ㄱㅅ, 넹) — не ошибка. Неуместный для собеседника уровень вежливости — ошибка.",
          "Если слово похоже на опечатку, выбирай вариант по смыслу сообщения и разговора, а не ближайший по написанию.",
        ]),
    'Верни JSON: {"corrected": "...", "fixes": [{"wrong": "...", "right": "...", "why": "...", "category": "...", "slip": false}], "natural": "..."}, где',
    lang.code === "en"
      ? "slip — true, если это описка, а не незнание: опечатка, пропущенная или переставленная буква, чатовое сокращение (ths вместо thx, teh вместо the);"
      : "slip — true, если это описка, а не незнание: опечатка, пропущенная или переставленная буква или слог;",
    lang.code === "en"
      ? "false — грамматика, неверное слово или слово, которое человек явно не умеет писать (beautifull, recieve),"
      : "false — грамматика, неверная частица или окончание, неверное слово или слово, которое человек явно не умеет писать,",
    `category — одна тема из списка: ${mistakeCategories(lang).join(", ")}. Только название темы, подробности — в wrong/right/why,`,
    "corrected — исправленный текст, в котором изменённые слова обёрнуты в **двойные звёздочки** (если ошибок нет — исходный текст),",
    "fixes — список ошибок (пусто, если их нет), why — короткое объяснение правила на русском,",
    "natural — более естественный вариант всей фразы или пустая строка.",
    "",
    context.length
      ? "В чатах одну мысль часто пишут несколькими сообщениями подряд. Если проверяемое сообщение продолжает предыдущее сообщение того же автора, читай их как одно предложение и не исправляй то, что верно как его продолжение."
      : "",
    author ? `Проверяемое сообщение написал(а): ${author}` : "",
    leadIn.length
      ? `Это продолжение реплики того же автора, разбитой на сообщения. Целиком она звучит так: «${[...leadIn, text].join(" ")}». Проверяемая часть — только последняя («${text}»): оценивай её как продолжение этого предложения, а не как отдельную фразу, и исправляй только ошибки внутри неё.`
      : "",
    context.length ? "Проверь только это сообщение:" : "Текст:",
    text,
  ]
    .filter((line, i, all) => line !== "" || (i > 0 && all[i - 1] !== ""))
    .join("\n");
}

export function parseCheck(text: string): CheckResult {
  return checkSchema.parse(jsonObject(text));
}
