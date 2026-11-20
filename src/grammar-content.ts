/**
 * Контент грамматики. **Ручной, не сгенерированный** — и это осознанно.
 *
 * Проверка ответов идёт сравнением строк (см. `services/grammar-topics.ts`), поэтому каждая ошибка в
 * контенте означала бы, что человек отвечает правильно, а бот говорит «неверно». Такой контент нельзя
 * получать от модели «на лету»: она ошибается незаметно, а здесь ошибка видна пользователю мгновенно.
 *
 * Формат:
 * - `choice` — выбрать из вариантов (`options`), `answer` дословно равен одному из них;
 * - `gap` — вписать в пропуск, `prompt` содержит `___`;
 * - `order` — собрать предложение, `options` — слова в перемешанном виде, `answer` — верный порядок.
 *
 * `why` пишется так, чтобы его понял человек, а не лингвист: одно предложение, без терминов без нужды.
 */

export type GrammarKind = "choice" | "gap" | "order";

export interface ExerciseDraft {
  kind: GrammarKind;
  prompt: string;
  options?: string[];
  answer: string;
  why: string;
}

export interface TopicDraft {
  slug: string;
  title: string;
  level: string;
  /** Язык темы; по умолчанию английский — корейские темы добавятся сюда же. */
  language?: "en" | "ko";
  rule: string;
  examples: string[];
  exercises: ExerciseDraft[];
}

export const GRAMMAR_TOPICS: TopicDraft[] = [
  {
    slug: "present-simple",
    title: "Present Simple: что делаю обычно",
    level: "A1",
    rule:
      "Present Simple — про привычки, факты и расписания: то, что происходит вообще, а не прямо сейчас. " +
      "С he/she/it к глаголу добавляется -s: I work, но he works. Вопрос и отрицание делаются через do/does, " +
      "и тогда -s уходит к does: Does he work? He doesn't work.",
    examples: [
      "I work in an office — обычное место работы, не «сейчас работаю».",
      "She drinks coffee every morning — привычка.",
      "Does he live in Moscow? — вопрос через does, у глагола -s нет.",
      "They don't watch TV — отрицание через don't.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "She ___ coffee every morning.",
        options: ["drink", "drinks", "is drinking"],
        answer: "drinks",
        why: "С he/she/it в Present Simple к глаголу добавляется -s: she drinks.",
      },
      {
        kind: "gap",
        prompt: "He ___ (work) at a bank.",
        answer: "works",
        why: "He — третье лицо единственного числа, поэтому work + s.",
      },
      {
        kind: "choice",
        prompt: "___ they live in London?",
        options: ["Do", "Does", "Are"],
        answer: "Do",
        why: "С they вопрос строится через do: Do they live…",
      },
      {
        kind: "choice",
        prompt: "He ___ like fish.",
        options: ["doesn't", "don't", "isn't"],
        answer: "doesn't",
        why: "Отрицание для he — doesn't, и глагол после него без -s.",
      },
      {
        kind: "gap",
        prompt: "My sister ___ (study) at university.",
        answer: "studies",
        why: "Глагол на -y после согласной: study → studies.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она не работает по воскресеньям».",
        options: ["She", "doesn't", "work", "on", "Sundays"],
        answer: "She doesn't work on Sundays",
        why: "Отрицание: подлежащее + doesn't + глагол без -s.",
      },
      {
        kind: "choice",
        prompt: "The train ___ at 7:30.",
        options: ["leaves", "leave", "is leaving"],
        answer: "leaves",
        why: "Расписание — это Present Simple; the train — единственное число, значит leaves.",
      },
    ],
  },
  {
    slug: "present-continuous",
    title: "Present Continuous: что делаю сейчас",
    level: "A1",
    rule:
      "Present Continuous — про действие прямо сейчас или в этот период: am/is/are + глагол с -ing. " +
      "Сравните: I work here (вообще) и I'm working now (в этот момент). Глаголы состояния " +
      "(know, like, want, need) обычно в Continuous не ставят.",
    examples: [
      "I'm reading a book — прямо сейчас.",
      "She is working from home this week — временный период.",
      "They aren't listening to us — отрицание через aren't.",
      "Are you waiting for me? — вопрос: are в начале.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "Be quiet, the baby ___ .",
        options: ["sleeps", "is sleeping", "sleep"],
        answer: "is sleeping",
        why: "Действие происходит прямо сейчас — значит Present Continuous.",
      },
      {
        kind: "gap",
        prompt: "I ___ (read) a very good book this week.",
        answer: "am reading",
        why: "Временный период (this week) — Continuous: am + reading.",
      },
      {
        kind: "choice",
        prompt: "___ you listening to me?",
        options: ["Do", "Are", "Is"],
        answer: "Are",
        why: "В Continuous вопрос строится перестановкой: Are you listening?",
      },
      {
        kind: "choice",
        prompt: "I ___ what you mean.",
        options: ["am knowing", "know", "knowing"],
        answer: "know",
        why: "Know — глагол состояния, в Continuous не употребляется.",
      },
      {
        kind: "gap",
        prompt: "They ___ (not / work) today — it's a holiday.",
        answer: "aren't working",
        why: "Отрицание в Continuous: aren't + working. Not и work пишутся через пробел, поэтому «aren't working».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она сейчас готовит ужин».",
        options: ["She", "is", "cooking", "dinner", "now"],
        answer: "She is cooking dinner now",
        why: "Порядок: подлежащее + is + глагол с -ing + дополнение.",
      },
    ],
  },
  {
    slug: "articles",
    title: "Артикли a / an / the",
    level: "A2",
    rule:
      "a/an — один из многих, впервые упомянутый предмет; an перед гласным звуком. the — тот самый, " +
      "уже известный или единственный в своём роде. Если говорим о чём-то вообще во множественном числе " +
      "или о неисчисляемом — артикль не нужен: I like coffee.",
    examples: [
      "I saw a dog — какую-то собаку, впервые.",
      "The dog was big — та самая собака, уже знакомая.",
      "She is an engineer — an перед гласным звуком.",
      "I like music — неисчисляемое, без артикля.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I bought ___ umbrella yesterday.",
        options: ["a", "an", "the"],
        answer: "an",
        why: "Umbrella начинается с гласного звука — an.",
      },
      {
        kind: "gap",
        prompt: "She's ___ teacher.",
        answer: "a",
        why: "Профессия в единственном числе: a teacher.",
      },
      {
        kind: "choice",
        prompt: "Can you close ___ door, please?",
        options: ["a", "an", "the"],
        answer: "the",
        why: "Речь о конкретной двери, которая рядом — the.",
      },
      {
        kind: "choice",
        prompt: "I don't drink ___ coffee in the evening.",
        options: ["a", "the", "— (без артикля)"],
        answer: "— (без артикля)",
        why: "Coffee — неисчисляемое, говорим о нём вообще: без артикля.",
      },
      {
        kind: "gap",
        prompt: "He is ___ honest man.",
        answer: "an",
        why: "Honest начинается с гласного ЗВУКА (h не читается) — an, хотя буква согласная.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я видел очень красивую машину».",
        options: ["I", "saw", "a", "very", "beautiful", "car"],
        answer: "I saw a very beautiful car",
        why: "Впервые упомянутая машина — a, и оно стоит перед прилагательным.",
      },
    ],
  },
  {
    slug: "past-simple",
    title: "Past Simple: что было",
    level: "A2",
    rule:
      "Past Simple — законченное действие в прошлом. Правильные глаголы берут -ed (work → worked), " +
      "неправильные меняются совсем (go → went, see → saw, buy → bought). Вопрос и отрицание — через did, " +
      "и тогда глагол возвращается в обычную форму: Did you go? I didn't see.",
    examples: [
      "I worked late yesterday — законченное действие.",
      "She went home at six — go → went.",
      "Did you see him? — вопрос через did, глагол без -ed.",
      "We didn't buy anything — отрицание через didn't.",
    ],
    exercises: [
      {
        kind: "gap",
        prompt: "I ___ (see) him yesterday.",
        answer: "saw",
        why: "See — неправильный глагол, прошедшее время saw.",
      },
      {
        kind: "choice",
        prompt: "Did you ___ the film?",
        options: ["see", "saw", "seen"],
        answer: "see",
        why: "После did глагол идёт в обычной форме — see, не saw.",
      },
      {
        kind: "choice",
        prompt: "We ___ to the cinema last night.",
        options: ["go", "went", "gone"],
        answer: "went",
        why: "Last night — прошлое; go → went.",
      },
      {
        kind: "gap",
        prompt: "She ___ (not / finish) her homework.",
        answer: "didn't finish",
        why: "Отрицание в прошлом: didn't + глагол в обычной форме.",
      },
      {
        kind: "choice",
        prompt: "They ___ married in 2019.",
        options: ["get", "got", "gotten"],
        answer: "got",
        why: "Get → got в Past Simple.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он купил новую машину в прошлом году».",
        options: ["He", "bought", "a", "new", "car", "last", "year"],
        answer: "He bought a new car last year",
        why: "Buy → bought, время указано в конце: last year.",
      },
    ],
  },
  {
    slug: "prepositions-time",
    title: "Предлоги времени: in / on / at",
    level: "A2",
    rule:
      "at — точное время (at 7 o'clock, at noon). on — день и дата (on Monday, on 5 May). " +
      "in — месяц, год, сезон и длинный период (in July, in 2020, in winter, in the morning). " +
      "Запомнить проще от точного к длинному: at → on → in.",
    examples: [
      "The lesson starts at 9 — точное время.",
      "We meet on Fridays — день недели.",
      "My birthday is in May — месяц.",
      "I'll call you in the evening — часть дня.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The film starts ___ 8 o'clock.",
        options: ["at", "on", "in"],
        answer: "at",
        why: "Точное время — at.",
      },
      {
        kind: "gap",
        prompt: "My birthday is ___ July.",
        answer: "in",
        why: "Месяц — in.",
      },
      {
        kind: "choice",
        prompt: "We have a meeting ___ Monday.",
        options: ["at", "on", "in"],
        answer: "on",
        why: "День недели — on.",
      },
      {
        kind: "choice",
        prompt: "She was born ___ 1995.",
        options: ["at", "on", "in"],
        answer: "in",
        why: "Год — in.",
      },
      {
        kind: "gap",
        prompt: "I usually read ___ night.",
        answer: "at",
        why: "At night — устойчивое сочетание, как at noon.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Созвон в пятницу в три часа».",
        options: ["The", "call", "is", "on", "Friday", "at", "three"],
        answer: "The call is on Friday at three",
        why: "Сначала день (on Friday), потом точное время (at three).",
      },
    ],
  },
];
