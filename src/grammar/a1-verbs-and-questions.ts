import type { TopicDraft } from "./types";

/**
 * Темы A1: базовые глаголы и вопросы.
 *
 * Почему вместе: повелительное наклонение, местоимения, наречия частоты и can — это первые «кирпичи»
 * живой фразы; без них нельзя ни попросить, ни сказать, кто что делает, как часто и что умеет.
 */
export const A1_VERBS_QUESTIONS: TopicDraft[] = [
  {
      slug: "imperatives",
      category: "формы глаголов",
      title: "Повелительное наклонение",
      level: "A1",
      rule:
        "Повелительное наклонение — это команда или просьба: предложение начинается прямо с глагола в начальной форме, " +
        "а подлежащего (you) в нём нет. Отрицание строится через don't перед глаголом: Don't run. " +
        "Глагол be тоже не боится повелительного, но не превращается в are: Be careful. " +
        "Главная ловушка — лишнее «to» перед глаголом и лишнее «you» в начале.",
      examples: [
        "Sit down, please — просьба из одного глагола, подлежащего нет.",
        "Don't be late again — отрицание через don't, а не через not.",
        "Be polite to the staff — be в команде, без are и без you.",
        "Come in, please — команда начинается прямо с глагола.",
        "Don't forget your passport — don't + глагол, «to» не нужен.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "___ the window, please. It's hot in here.",
          options: ["Open", "To open", "You open"],
          answer: "Open",
          why: "Команда начинается с чистого глагола: «to open» — это инфинитив для других конструкций, а «you open» — уже утверждение с подлежащим.",
        },
        {
          kind: "choice",
          prompt: "___ smoke here — it's a hospital.",
          options: ["Don't", "Not", "No"],
          answer: "Don't",
          why: "Запрет в повелительном строится только через don't + глагол: not и no перед глаголом в этой роли не работают.",
        },
        {
          kind: "choice",
          prompt: "___ patient, the doctor is busy.",
          options: ["Be", "Are", "You are"],
          answer: "Be",
          why: "В команде be стоит в начальной форме: are требует подлежащего, которого в повелительном нет.",
        },
        {
          kind: "choice",
          prompt: "___ me your phone number, please.",
          options: ["Give", "To give", "Giving"],
          answer: "Give",
          why: "Просьба — это глагол в первой форме без окончаний: giving и to give здесь не команда, а части других конструкций.",
        },
        {
          kind: "choice",
          prompt: "___ be afraid of the dog — he is friendly.",
          options: ["Don't", "Not", "Doesn't"],
          answer: "Don't",
          why: "Отрицательная команда — don't + глагол; doesn't работает только с he/she/it в обычном предложении и требует подлежащего.",
        },
        {
          kind: "choice",
          prompt: "Please ___ careful in the lab.",
          options: ["be", "are", "is"],
          answer: "be",
          why: "После please всё ещё повелительное наклонение, поэтому be: are и is тянут за собой подлежащее, которого тут нет.",
        },
        {
          kind: "gap",
          prompt: "___ (not / touch) the paint — it's wet.",
          answer: "Don't touch",
          why: "Запрет: don't ставится перед глаголом, а сам глагол идёт без to и без -s.",
        },
        {
          kind: "gap",
          prompt: "___ (not / be) afraid of the dark.",
          answer: "Don't be",
          why: "Отрицание от be в команде — don't be; «not be» без don't в начале фразы не звучит.",
        },
        {
          kind: "gap",
          prompt: "___ (turn) left after the bank.",
          answer: "Turn",
          why: "Указание дороги — команда, поэтому глагол в первой форме и без подлежащего you.",
        },
        {
          kind: "gap",
          prompt: "___ (wait) for me here, please.",
          answer: "Wait",
          why: "Просьба-команда: глагол в начальной форме, без to и без -ing.",
        },
        {
          kind: "order",
          prompt: "Собери команду: «Закрой дверь, пожалуйста».",
          options: ["Please", "close", "the", "door"],
          answer: "Please close the door",
          why: "Please может стоять в начале, но сам приказ всё равно начинается с глагола — подлежащего нет.",
        },
        {
          kind: "order",
          prompt: "Собери запрет: «Не открывай окно».",
          options: ["Don't", "open", "the", "window"],
          answer: "Don't open the window",
          why: "Порядок в запрете жёсткий: сначала don't, потом глагол без to.",
        },
        {
          kind: "order",
          prompt: "Собери просьбу: «Не шуми здесь, пожалуйста».",
          options: ["Please", "don't", "make", "noise", "here"],
          answer: "Please don't make noise here",
          why: "Please идёт впереди, но don't остаётся прямо перед глаголом make.",
        },
      ],
    },
  {
      slug: "pronouns-personal",
      category: "выбор слова",
      title: "Местоимения: I / me, he / him",
      level: "A1",
      rule:
        "У личных местоимений две формы: подлежащая (I, he, she, we, they) и объектная (me, him, her, us, them). " +
        "Подлежащая форма делает действие, объектная — получает его: She called me. " +
        "После предлога (for, with, to, between) всегда объектная форма: for him, with us. " +
        "Ловушка — «between you and I»: после between нужен me, даже если рядом стоит you.",
      examples: [
        "She called me yesterday — me после глагола: действие направлено на меня.",
        "They phoned us twice — us, а не we: мы получатели звонка.",
        "This present is for him — после предлога ставим объектную форму.",
        "He and I work in the same office — в роли подлежащего нужны he и I.",
        "Between you and me, this is a secret — после between только me.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "___ is my best friend.",
          options: ["She", "Her", "Hers"],
          answer: "She",
          why: "Местоимение стоит на месте подлежащего перед is, значит нужна подлежащая форма she.",
        },
        {
          kind: "choice",
          prompt: "I saw ___ at the station yesterday.",
          options: ["he", "him", "his"],
          answer: "him",
          why: "После глагола saw идёт тот, на кого направлено действие, — объектная форма him.",
        },
        {
          kind: "choice",
          prompt: "Give the book to ___ , please.",
          options: ["I", "me", "my"],
          answer: "me",
          why: "После предлога to всегда объектная форма; I и my в этой позиции невозможны.",
        },
        {
          kind: "choice",
          prompt: "Tom and ___ are going to the cinema tonight.",
          options: ["I", "me", "my"],
          answer: "I",
          why: "Tom and … вместе делают действие (are going), значит нужно подлежащее местоимение I, хотя после «and» рука тянется к me.",
        },
        {
          kind: "choice",
          prompt: "There is no secret between Anna and ___ .",
          options: ["I", "me", "my"],
          answer: "me",
          why: "Between — предлог, а после предлога ставится объектная форма; поэтому me, хотя рядом стоит имя.",
        },
        {
          kind: "choice",
          prompt: "Can you help ___ with the bags?",
          options: ["we", "us", "our"],
          answer: "us",
          why: "Мы — те, кому помогают, то есть объект после help: us, а не we.",
        },
        {
          kind: "gap",
          prompt: "___ (she) works at the airport.",
          answer: "She",
          why: "Местоимение делает действие (works) и стоит перед глаголом, поэтому нужна подлежащая форма She.",
        },
        {
          kind: "gap",
          prompt: "Please wait for ___ (we) outside.",
          answer: "us",
          why: "For — предлог, значит нужна объектная форма us; we после предлога невозможно.",
        },
        {
          kind: "gap",
          prompt: "He called ___ (she) three times.",
          answer: "her",
          why: "Действие направлено на неё, поэтому объектная форма her, а не she.",
        },
        {
          kind: "gap",
          prompt: "My parents and ___ (he) live in the same building.",
          answer: "he",
          why: "После «and» местоимение — часть подлежащего при live, поэтому he; «my parents and him» сломало бы согласование с глаголом.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она пригласила его на ужин».",
          options: ["She", "invited", "him", "to", "dinner"],
          answer: "She invited him to dinner",
          why: "Подлежащее she впереди, а тот, кого пригласили, стоит после глагола — him.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Мы видели их в парке».",
          options: ["We", "saw", "them", "in", "the", "park"],
          answer: "We saw them in the park",
          why: "We делает действие, them его получает: меняется форма, а не место в предложении.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Они подарили мне книгу».",
          options: ["They", "gave", "me", "a", "book"],
          answer: "They gave me a book",
          why: "Тот, кому дарят, стоит после глагола и получает объектную форму me.",
        },
      ],
    },
  {
      slug: "adverbs-frequency",
      category: "порядок слов",
      title: "Наречия частоты: always, usually",
      level: "A1",
      rule:
        "Наречия частоты (always, usually, often, sometimes, never) отвечают на вопрос «как часто» и стоят " +
        "перед смысловым глаголом: I always drink coffee. Но с глаголом be они идут после него: She is always late. " +
        "Между вспомогательным и смысловым глаголом наречие тоже встаёт перед смысловым: I don't often go there. " +
        "Never само по себе отрицание, поэтому don't при нём не нужен.",
      examples: [
        "I always drink tea in the morning — наречие перед смысловым глаголом.",
        "She is usually late — с be наречие идёт после него.",
        "We often go to the theatre — перед go, а не в конце.",
        "He never eats meat — never уже отрицание, don't не нужен.",
        "Sometimes I work at weekends — sometimes может открывать предложение.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "She ___ tired in the evening.",
          options: ["always is", "is always", "always"],
          answer: "is always",
          why: "Сказуемое здесь — be (is), а наречие частоты ставится после be, а не перед ним и не вместо него.",
        },
        {
          kind: "choice",
          prompt: "I ___ coffee in the morning.",
          options: ["always drink", "drink always", "always drinking"],
          answer: "always drink",
          why: "Перед смысловым глаголом в Present Simple наречие занимает место между подлежащим и глаголом.",
        },
        {
          kind: "choice",
          prompt: "He ___ eats meat — he is a vegetarian.",
          options: ["never", "doesn't never", "not never"],
          answer: "never",
          why: "Never уже несёт отрицание, поэтому второе отрицание (doesn't / not) перед ним было бы двойным.",
        },
        {
          kind: "choice",
          prompt: "They ___ to the cinema on Fridays.",
          options: ["usually go", "go usually", "usually going"],
          answer: "usually go",
          why: "Наречие встаёт перед go; «usually going» к тому же ломает Present Simple — нужна первая форма.",
        },
        {
          kind: "choice",
          prompt: "My brother ___ forgets his keys.",
          options: ["often", "often is", "is often"],
          answer: "often",
          why: "Сказуемое — forgets, а не be, поэтому наречие идёт прямо перед ним, без is.",
        },
        {
          kind: "choice",
          prompt: "___ I go to the gym before work.",
          options: ["Sometimes", "Sometimes am", "Am sometimes"],
          answer: "Sometimes",
          why: "Sometimes — самое свободное из наречий частоты: оно может стоять первым словом, и тогда be в начале не нужен.",
        },
        {
          kind: "gap",
          prompt: "He ___ (often) works at the weekend.",
          answer: "often",
          why: "Наречие занимает место перед смысловым глаголом works, но после подлежащего he.",
        },
        {
          kind: "gap",
          prompt: "My sister is ___ (usually) very quiet.",
          answer: "usually",
          why: "Перед нами be (is), поэтому наречие ставится после него, а не перед.",
        },
        {
          kind: "gap",
          prompt: "We ___ (never) go to bed before eleven.",
          answer: "never",
          why: "Never стоит перед смысловым go; отдельного don't при нём не требуется.",
        },
        {
          kind: "gap",
          prompt: "It ___ (sometimes) snows in May here.",
          answer: "sometimes",
          why: "Перед snows нужно наречие частоты, иначе «sometimes» окажется в конце и смысл поплывёт.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она всегда опаздывает».",
          options: ["She", "is", "always", "late"],
          answer: "She is always late",
          why: "Здесь сказуемое be, поэтому always идёт после is: «She always is late» — типичная ошибка.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Я обычно завтракаю дома».",
          options: ["I", "usually", "have", "breakfast", "at", "home"],
          answer: "I usually have breakfast at home",
          why: "Usually встаёт между подлежащим I и смысловым глаголом have, а не в конец.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Они никогда не смотрят телевизор».",
          options: ["They", "never", "watch", "TV"],
          answer: "They never watch TV",
          why: "Never одно закрывает отрицание, поэтому глагол остаётся положительным — watch, без don't.",
        },
      ],
    },
  {
      slug: "modal-can",
      category: "модальные глаголы",
      title: "Can / can't: умею и могу",
      level: "A1",
      rule:
        "Can говорит об умении и о разрешении: I can swim, Can I come in? После can глагол идёт в начальной форме — " +
        "без to и без -s: she can swim, а не «she cans swim». Отрицание — can't, вопрос — can в начале: Can you help? " +
        "У can нет формы с -s, потому что он не меняется по лицам.",
      examples: [
        "I can ride a bike — после can глагол стоит без to.",
        "She can speak three languages — с she у can нет -s.",
        "Can you help me? — вопрос: can выходит вперёд.",
        "He can't come today — отрицание это can't, без don't.",
        "You can't smoke in the office — can't ещё и запрещает.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "She ___ swim very well.",
          options: ["can", "cans", "can to"],
          answer: "can",
          why: "Can не меняется по лицам, поэтому с she он остаётся can — без -s и без to.",
        },
        {
          kind: "choice",
          prompt: "I ___ swim — I never learned.",
          options: ["can't", "don't can", "not can"],
          answer: "can't",
          why: "Отрицание модального глагола делается самим can't; do с модальными не используется.",
        },
        {
          kind: "choice",
          prompt: "___ your brother drive a car?",
          options: ["Can", "Does can", "Is"],
          answer: "Can",
          why: "Вопрос с can строится перестановкой: can вперёд, подлежащее после него, без does.",
        },
        {
          kind: "choice",
          prompt: "___ I use your phone, please?",
          options: ["Can", "Do", "Am"],
          answer: "Can",
          why: "Просьба о разрешении — это can в начале: do и am к модальному смыслу «можно?» не подходят.",
        },
        {
          kind: "choice",
          prompt: "He can ___ the guitar very well.",
          options: ["play", "plays", "to play"],
          answer: "play",
          why: "После can глагол теряет и -s, и to: can уже показывает лицо, а инфинитив без to — его форма.",
        },
        {
          kind: "choice",
          prompt: "You ___ park here — it's a no-parking zone.",
          options: ["can't", "not can", "don't"],
          answer: "can't",
          why: "Запрет выражает can't; «don't» здесь оставил бы park без модального смысла и без отрицания при нём.",
        },
        {
          kind: "gap",
          prompt: "My cousin ___ (can) play chess well.",
          answer: "can",
          why: "Умение передаётся can, и с my cousin (он/она) он не получает -s.",
        },
        {
          kind: "gap",
          prompt: "I ___ (not / can) come tomorrow — I'm busy.",
          answer: "can't",
          why: "Отрицание от can сливается в одно слово can't, а не в «don't can».",
        },
        {
          kind: "gap",
          prompt: "___ (can) you help me with this box?",
          answer: "Can",
          why: "В вопросе can выходит на первое место, а подлежащее you идёт после него.",
        },
        {
          kind: "gap",
          prompt: "We can ___ (meet) at six.",
          answer: "meet",
          why: "После can нужен чистый инфинитив: ни to, ни -ing, ни окончаний.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она умеет водить машину».",
          options: ["She", "can", "drive", "a", "car"],
          answer: "She can drive a car",
          why: "Порядок: подлежащее + can + глагол без -s и без to.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Ты умеешь плавать?»",
          options: ["Can", "you", "swim"],
          answer: "Can you swim",
          why: "В вопросе can стоит первым, а do для него не нужно.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Я совсем не умею готовить».",
          options: ["I", "can't", "cook", "at", "all"],
          answer: "I can't cook at all",
          why: "Can't уже отрицание, поэтому глагол cook идёт в первой форме и без don't.",
        },
      ],
    },
];
