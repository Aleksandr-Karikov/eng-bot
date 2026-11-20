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
  /**
   * Категория ошибки в терминах /check (`MISTAKE_CATEGORIES`): по ней промах в упражнении попадает
   * в общую работу над ошибками и подмешивается в карточки вместе с ошибками из переписки.
   */
  category: string;
  rule: string;
  examples: string[];
  exercises: ExerciseDraft[];
}

export const GRAMMAR_TOPICS: TopicDraft[] = [
  {
    slug: "present-simple",
    category: "времена",
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
    category: "времена",
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
    category: "артикли",
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
    category: "времена",
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
    slug: "plurals",
    title: "Множественное число",
    level: "A1",
    category: "множественное число",
    rule:
      "Обычное множественное — прибавь -s: book → books. После -s, -ss, -sh, -ch, -x, -z добавляется -es: " +
      "box → boxes. Согласная + y даёт -ies: city → cities, но гласная + y — просто -s: day → days. " +
      "Есть неправильные: man → men, child → children, foot → feet, tooth → teeth, mouse → mice.",
    examples: [
      "I have two books — обычное -s.",
      "Three boxes — после -x добавляется -es.",
      "Many cities — согласная + y даёт -ies.",
      "Two children — неправильная форма, не childs.",
    ],
    exercises: [
      {
        kind: "gap",
        prompt: "I bought two ___ (box) of pencils.",
        answer: "boxes",
        why: "После -x добавляется -es: box → boxes.",
      },
      {
        kind: "choice",
        prompt: "There are many ___ in Russia.",
        options: ["citys", "cities", "city"],
        answer: "cities",
        why: "Согласная + y: city → cities, y меняется на ies.",
      },
      {
        kind: "choice",
        prompt: "She has two ___ .",
        options: ["childs", "children", "childes"],
        answer: "children",
        why: "Child — неправильное: children, не childs.",
      },
      {
        kind: "gap",
        prompt: "My ___ (tooth) hurt.",
        answer: "teeth",
        why: "Tooth → teeth, как foot → feet.",
      },
      {
        kind: "choice",
        prompt: "We rested for two ___ .",
        options: ["days", "daies", "dayes"],
        answer: "days",
        why: "После гласной + y просто -s: day → days.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «У меня две сестры и три брата».",
        options: ["I", "have", "two", "sisters", "and", "three", "brothers"],
        answer: "I have two sisters and three brothers",
        why: "Обычное множественное: sister → sisters, brother → brothers.",
      },
    ],
  },
  {
    slug: "questions-do-does",
    title: "Вопросы: do / does / did",
    level: "A2",
    category: "порядок слов",
    rule:
      "Вопрос в простом времени строится через вспомогательный глагол впереди: Do you work? Does she work? " +
      "Did they work? После does и did смысловой глагол идёт в обычной форме, без -s и без -ed: " +
      "Does she work (не works), Did he go (не went).",
    examples: [
      "Do you like coffee? — вопрос о привычке.",
      "Does he live here? — с he/she/it берём does.",
      "Did they arrive yesterday? — прошедшее время, did.",
      "Where did you go? — вопрос с вопросительным словом: слово + did + подлежащее.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "___ she speak English?",
        options: ["Do", "Does", "Is"],
        answer: "Does",
        why: "She — третье лицо, значит does.",
      },
      {
        kind: "choice",
        prompt: "Did he ___ to the party?",
        options: ["go", "went", "goes"],
        answer: "go",
        why: "После did глагол в обычной форме: go, не went.",
      },
      {
        kind: "gap",
        prompt: "___ you like tea? (вопросительное слово не нужно)",
        answer: "Do",
        why: "You — не третье лицо, значит do.",
      },
      {
        kind: "choice",
        prompt: "Where ___ they live?",
        options: ["do", "does", "did"],
        answer: "do",
        why: "They — множественное, значит do; did был бы про прошлое.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Ты говоришь по-французски?»",
        options: ["Do", "you", "speak", "French"],
        answer: "Do you speak French",
        why: "Вопрос начинается со вспомогательного: Do + you + глагол.",
      },
      {
        kind: "choice",
        prompt: "___ it rain yesterday?",
        options: ["Do", "Does", "Did"],
        answer: "Did",
        why: "Yesterday — прошлое, поэтому did.",
      },
    ],
  },
  {
    slug: "comparatives",
    title: "Сравнение: -er / more",
    level: "A2",
    category: "формы глаголов",
    rule:
      "Короткое слово (один слог) берёт -er: big → bigger, и сравнение идёт с than. Длинное (два слога и больше) " +
      "берёт more: more interesting. Есть неправильные: good → better, bad → worse, far → further. " +
      "Превосходная степень — the -est или the most.",
    examples: [
      "This box is bigger than that one — короткое слово, -er.",
      "This book is more interesting — длинное слово, more.",
      "She is better at chess than me — good → better.",
      "It's the most expensive hotel — превосходная: the most.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "My car is ___ than yours.",
        options: ["faster", "more fast", "fastest"],
        answer: "faster",
        why: "Fast — один слог, значит -er: faster than.",
      },
      {
        kind: "choice",
        prompt: "This film is ___ than the book.",
        options: ["interestinger", "more interesting", "most interesting"],
        answer: "more interesting",
        why: "Interesting — длинное слово, сравнение через more.",
      },
      {
        kind: "gap",
        prompt: "Her English is ___ (good) than mine.",
        answer: "better",
        why: "Good — неправильное: better, не gooder.",
      },
      {
        kind: "choice",
        prompt: "Today the weather is ___ than yesterday.",
        options: ["worse", "badder", "more bad"],
        answer: "worse",
        why: "Bad — неправильное: worse.",
      },
      {
        kind: "gap",
        prompt: "This is the ___ (expensive) restaurant in the city.",
        answer: "most expensive",
        why: "Превосходная степень длинного слова: the most expensive.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Москва больше, чем Казань».",
        options: ["Moscow", "is", "bigger", "than", "Kazan"],
        answer: "Moscow is bigger than Kazan",
        why: "Big → bigger (удвоение согласной), сравнение через than.",
      },
    ],
  },
  {
    slug: "some-any",
    title: "Some / any / no",
    level: "A2",
    category: "выбор слова",
    rule:
      "some — в утверждениях: I have some money. any — в вопросах и отрицаниях: Do you have any money? " +
      "I don't have any money. some тоже бывает в вопросе, когда предлагаем или просим: Would you like some tea? " +
      "no — не «не any», а сразу «нет»: There is no milk (сильнее, чем not any).",
    examples: [
      "I need some help — утверждение.",
      "Do you have any questions? — вопрос.",
      "There isn't any bread — отрицание.",
      "Would you like some coffee? — предложение, поэтому some.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I need ___ milk for the cake.",
        options: ["some", "any", "no"],
        answer: "some",
        why: "Утверждение — some.",
      },
      {
        kind: "choice",
        prompt: "Do you have ___ brothers or sisters?",
        options: ["some", "any", "no"],
        answer: "any",
        why: "Вопрос — any.",
      },
      {
        kind: "gap",
        prompt: "There isn't ___ sugar in the cupboard.",
        answer: "any",
        why: "Отрицание — any.",
      },
      {
        kind: "choice",
        prompt: "Would you like ___ tea?",
        options: ["some", "any", "no"],
        answer: "some",
        why: "Предложение угощения — some, хотя это вопрос.",
      },
      {
        kind: "choice",
        prompt: "There is ___ time left, we must hurry.",
        options: ["some", "any", "no"],
        answer: "no",
        why: "«Совсем нет» — сразу no, без not.",
      },
      {
        kind: "order",
        prompt: "Собери отрицание: «У нас нет денег».",
        options: ["We", "don't", "have", "any", "money"],
        answer: "We don't have any money",
        why: "Отрицание через don't + any.",
      },
    ],
  },
  {
    slug: "there-is-are",
    title: "There is / there are",
    level: "A1",
    category: "согласование",
    rule:
      "There is — про одно: There is a cat. There are — про много: There are two cats. " +
      "Глагол согласуется с тем, что идёт сразу после него. Вопрос — перестановкой: Is there a shop near here? " +
      "Отрицание — через isn't / aren't.",
    examples: [
      "There is a shop on the corner — один магазин.",
      "There are many people here — много людей.",
      "Is there any milk? — вопрос с перестановкой.",
      "There aren't any chairs — отрицание.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "___ a book on the table.",
        options: ["There is", "There are", "It is"],
        answer: "There is",
        why: "A book — одно, значит there is.",
      },
      {
        kind: "choice",
        prompt: "___ many shops in this street.",
        options: ["There is", "There are", "There have"],
        answer: "There are",
        why: "Many shops — множественное, there are.",
      },
      {
        kind: "gap",
        prompt: "___ there any milk in the fridge?",
        answer: "Is",
        why: "Milk неисчисляемое — единственное число, значит is.",
      },
      {
        kind: "choice",
        prompt: "___ two cats and a dog in the yard.",
        options: ["There is", "There are", "There was"],
        answer: "There are",
        why: "Смотрим на первое существительное: two cats — множественное.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Есть ли здесь банк рядом?»",
        options: ["Is", "there", "a", "bank", "near", "here"],
        answer: "Is there a bank near here",
        why: "Вопрос: Is + there + существительное.",
      },
      {
        kind: "choice",
        prompt: "There ___ any chairs in the room.",
        options: ["isn't", "aren't", "not are"],
        answer: "aren't",
        why: "Chairs — множественное, отрицание aren't.",
      },
    ],
  },
  {
    slug: "prepositions-time",
    category: "предлоги",
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
