import type { TopicDraft } from "./types";

/**
 * Темы A1: количество и планы. Эти четыре темы держатся вместе, потому что все они — про выбор формы
 * там, где русский язык подсказывает неверный вариант: «сколько денег» тянет за собой many, «я иду
 * путешествовать» — инфинитив без to, «мне нравится готовить» — инфинитив вместо -ing, а «где ты живёшь»
 * сохраняет русский порядок слов.
 */
export const A1_QUANTITY_PLANS: TopicDraft[] = [
  {
      slug: "countables-much-many",
      category: "выбор слова",
      title: "Much / many, a lot of",
      level: "A1",
      rule:
        "Much — для неисчисляемого (money, time, water), many — для исчисляемого во множественном числе " +
        "(books, people). Оба нужны в вопросах и отрицаниях: How much time do we have? There aren't many shops here. " +
        "В утверждении ты скажешь a lot of — и с неисчисляемым, и с исчисляемым: a lot of money, a lot of friends. " +
        "Проверяй себя вопросом «можно ли посчитать это по штукам?»: если нет — much. «How many money» — самая " +
        "частая ошибка, потому что по-русски деньги легко представить штуками.",
      examples: [
        "How much time do we have? — time неисчисляемое, поэтому much.",
        "How many people came? — people считаются, значит many.",
        "There isn't much water in the bottle — отрицание с неисчисляемым.",
        "We don't have many options — отрицание с исчисляемым.",
        "She has a lot of friends — в утверждении звучит a lot of.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "How ___ money do you need for the trip?",
          options: ["much", "many", "a lot"],
          answer: "much",
          why: "Money не считают по штукам, поэтому в вопросе с ним стоит much: вариант many здесь невозможен.",
        },
        {
          kind: "choice",
          prompt: "How ___ people live in this house?",
          options: ["many", "much", "a lot"],
          answer: "many",
          why: "People — исчисляемое множественное (one person, two people), поэтому в вопросе how many.",
        },
        {
          kind: "choice",
          prompt: "There isn't ___ milk left in the bottle.",
          options: ["much", "many", "a lot of"],
          answer: "much",
          why: "Milk неисчисляемое, а перед нами отрицание — там и стоит much, а не a lot of.",
        },
        {
          kind: "choice",
          prompt: "We don't have ___ chairs for all the guests.",
          options: ["many", "much", "a lot of"],
          answer: "many",
          why: "Chairs считаются, а в отрицании нужен many: much с множественным числом не сочетается.",
        },
        {
          kind: "choice",
          prompt: "We have ___ of homework today.",
          options: ["a lot", "much", "many"],
          answer: "a lot",
          why: "После пропуска уже стоит of, поэтому подходит только a lot: much of и many of здесь не ставятся.",
        },
        {
          kind: "choice",
          prompt: "I don't have ___ experience with children.",
          options: ["much", "many", "a lot"],
          answer: "much",
          why: "Experience здесь неисчисляемое («опыт» вообще), а вариант a lot без of не присоединяется к существительному.",
        },
        {
          kind: "gap",
          prompt: "There isn't ___ (much) butter left.",
          answer: "much",
          why: "Butter неисчисляемое, а not … much — обычная форма отрицания при нём.",
        },
        {
          kind: "gap",
          prompt: "How ___ (many) students are there in your group?",
          answer: "many",
          why: "Students исчисляемое множественное, значит в вопросе how many.",
        },
        {
          kind: "gap",
          prompt: "She doesn't earn ___ (much) money.",
          answer: "much",
          why: "После doesn't идёт отрицание, а money неисчисляемое — туда встаёт much.",
        },
        {
          kind: "gap",
          prompt: "I've got ___ (a lot) work this week.",
          answer: "a lot of",
          why: "Это утверждение, а не вопрос и не отрицание, поэтому a lot of — без of связка не работает.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «У меня много свободного времени сегодня».",
          options: ["I", "have", "a", "lot", "of", "free", "time", "today"],
          answer: "I have a lot of free time today",
          why: "Time неисчисляемое, а утверждение требует a lot of — of здесь часть конструкции, а не отдельный предлог.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Сколько денег у тебя в кармане?»",
          options: ["How", "much", "money", "do", "you", "have", "in", "your", "pocket"],
          answer: "How much money do you have in your pocket",
          why: "Money неисчисляемое, поэтому how much, а do выходит перед подлежащим you.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «В холодильнике не много яиц».",
          options: ["There", "aren't", "many", "eggs", "in", "the", "fridge"],
          answer: "There aren't many eggs in the fridge",
          why: "Eggs исчисляемое множественное, а отрицание с there строится как aren't … many.",
        },
      ],
    },
  {
      slug: "going-to",
      category: "времена",
      title: "Going to: планы",
      level: "A1",
      rule:
        "Планы и намерения на будущее ты описываешь через be going to + инфинитив: I'm going to visit my parents. " +
        "Форма be подстраивается под подлежащее — am, is или are, — а смысловой глагол стоит в начальной форме с to. " +
        "Вопрос строится перестановкой be: Are you going to come? Отрицание ставится после be: she isn't going to stay.",
      examples: [
        "I'm going to call you tonight — договорённость на вечер.",
        "She's going to open a small café — намерение.",
        "Are you going to help us? — вопрос: are в начале.",
        "He isn't going to sell the car — отрицание not после be.",
        "Look at the sky — it's going to snow — предсказание по тому, что видишь.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "She ___ to study medicine next year.",
          options: ["is going", "going", "goes"],
          answer: "is going",
          why: "She — третье лицо единственного числа, поэтому нужна связка is, а одной формы going без be не хватает.",
        },
        {
          kind: "choice",
          prompt: "I'm going ___ my grandparents on Sunday.",
          options: ["to visit", "visit", "visiting"],
          answer: "to visit",
          why: "После going to идёт смысловой глагол с to: going to visit. Без to получается «I'm going visit».",
        },
        {
          kind: "choice",
          prompt: "___ you going to tell him the truth?",
          options: ["Are", "Do", "Is"],
          answer: "Are",
          why: "С you в этой конструкции согласуется are, а do перед going to не ставится вовсе.",
        },
        {
          kind: "choice",
          prompt: "We ___ going to buy a new car this year.",
          options: ["aren't", "don't", "isn't"],
          answer: "aren't",
          why: "We требует are, а отрицание встаёт после be: aren't going to buy.",
        },
        {
          kind: "choice",
          prompt: "Look at those clouds! It ___ to rain.",
          options: ["is going", "goes", "is go"],
          answer: "is going",
          why: "It — единственное число, значит is; предсказание по тому, что видно, тоже идёт через going to.",
        },
        {
          kind: "gap",
          prompt: "They ___ (travel) to Spain next summer.",
          answer: "are going to travel",
          why: "They требует are, а после going to глагол стоит в начальной форме: are going to travel.",
        },
        {
          kind: "gap",
          prompt: "We ___ (not / stay) at a hotel this time.",
          answer: "aren't going to stay",
          why: "Отрицание ставится после be, а не перед ним: aren't going to stay, а не don't going to stay.",
        },
        {
          kind: "gap",
          prompt: "What ___ (you / do) after the lesson?",
          answer: "are you going to do",
          why: "В вопросе are выходит вперёд, перед you, а само действие передаёт going to do.",
        },
        {
          kind: "gap",
          prompt: "She ___ (visit) her aunt on Friday.",
          answer: "is going to visit",
          why: "План на конкретный день: she получает is, а visit идёт с to.",
        },
        {
          kind: "gap",
          prompt: "He ___ (not / tell) anyone about the plan.",
          answer: "isn't going to tell",
          why: "He — единственное число, поэтому is, а not встаёт сразу после be: isn't going to tell.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Я собираюсь учить английский каждый день».",
          options: ["I", "am", "going", "to", "learn", "English", "every", "day"],
          answer: "I am going to learn English every day",
          why: "Схема be + going to + инфинитив: am для I, а learn без -s и без -ing.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Мы собираемся поужинать вместе».",
          options: ["We", "are", "going", "to", "have", "dinner", "together"],
          answer: "We are going to have dinner together",
          why: "We — множественное, значит are; после to глагол have остаётся в начальной форме.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Ты собираешься смотреть фильм?»",
          options: ["Are", "you", "going", "to", "watch", "a", "film"],
          answer: "Are you going to watch a film",
          why: "Вопрос начинается со связки are, дальше you, going to и watch — do здесь не нужен.",
        },
      ],
    },
  {
      slug: "like-ing",
      category: "формы глаголов",
      title: "like / hate / love + -ing",
      level: "A1",
      rule:
        "После like, love и hate глагол ставится с -ing: I like cooking, she hates waiting. После enjoy — только -ing, " +
        "инфинитив с to там невозможен вообще. Не путай с want и would like: после них нужен to + инфинитив. " +
        "И следи за буквами: get → getting, make → making.",
      examples: [
        "I like cooking at home — после like идёт -ing.",
        "She loves drawing animals — love + -ing, не инфинитив.",
        "He hates waiting in lines — hate + -ing.",
        "They enjoy walking in the park — enjoy требует -ing.",
        "I want to learn Japanese — после want, наоборот, to + инфинитив.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "My brother enjoys ___ computer games.",
          options: ["playing", "to play", "play"],
          answer: "playing",
          why: "Enjoy не берёт инфинитив ни с to, ни без: после него возможна только форма на -ing.",
        },
        {
          kind: "choice",
          prompt: "I like ___ new people.",
          options: ["meeting", "meet", "met"],
          answer: "meeting",
          why: "После like нужна форма на -ing; meet без окончания — калька с русского «люблю знакомиться».",
        },
        {
          kind: "choice",
          prompt: "She loves ___ in the morning.",
          options: ["running", "runing", "runned"],
          answer: "running",
          why: "Короткий глагол на согласную удваивает её перед -ing: run → running, а не runing.",
        },
        {
          kind: "choice",
          prompt: "He doesn't mind ___ the dishes.",
          options: ["washing", "to wash", "wash"],
          answer: "washing",
          why: "Mind, как и enjoy, требует -ing; инфинитив после него не ставится.",
        },
        {
          kind: "choice",
          prompt: "I hate ___ for the bus in the rain.",
          options: ["waiting", "to waiting", "wait"],
          answer: "waiting",
          why: "После hate идёт -ing: waiting. Вариант to waiting смешивает две несовместимые формы.",
        },
        {
          kind: "gap",
          prompt: "My sister loves ___ (swim) in the sea.",
          answer: "swimming",
          why: "Love + -ing, а короткий swim удваивает m: swimming.",
        },
        {
          kind: "gap",
          prompt: "She likes ___ (cook) for her friends.",
          answer: "cooking",
          why: "После like нужна форма на -ing: cook → cooking.",
        },
        {
          kind: "gap",
          prompt: "We enjoy ___ (watch) films at home.",
          answer: "watching",
          why: "Enjoy требует -ing, поэтому watch → watching.",
        },
        {
          kind: "gap",
          prompt: "My brother hates ___ (get) up early.",
          answer: "getting",
          why: "Hate + -ing, а get удваивает t перед окончанием: getting.",
        },
        {
          kind: "gap",
          prompt: "My parents want ___ (buy) a new house.",
          answer: "to buy",
          why: "Want не входит в эту группу: после него to + инфинитив, а не -ing.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Я люблю читать перед сном».",
          options: ["I", "love", "reading", "before", "bed"],
          answer: "I love reading before bed",
          why: "После love стоит reading, а не read: именно форма на -ing и проверяется.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Мы не любим работать в выходные».",
          options: ["We", "don't", "like", "working", "at", "weekends"],
          answer: "We don't like working at weekends",
          why: "После don't like нужна форма на -ing: working, а не work.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Он любит играть в футбол с друзьями».",
          options: ["He", "likes", "playing", "football", "with", "his", "friends"],
          answer: "He likes playing football with his friends",
          why: "Like + -ing: playing; -s уже стоит у likes, поэтому сам глагол его не получает.",
        },
      ],
    },
  {
      slug: "questions-wh",
      category: "порядок слов",
      title: "Вопросы: what, where, when",
      level: "A1",
      rule:
        "В wh-вопросе сначала идёт вопросительное слово, потом do или does, потом подлежащее и глагол: Where do you live? " +
        "Does забирает -s у глагола, поэтому What does she want, а не «What does she wants». " +
        "Если в предложении be, do не нужен — только перестановка: Where are you from? " +
        "Порядок «Where you live?» — русская калька, в английском так нельзя.",
      examples: [
        "Where do you work? — do стоит перед подлежащим.",
        "What does he want? — does забрал -s у want.",
        "When are you free? — с be do не нужен.",
        "Where are you from? — вопрос к be строится перестановкой.",
        "Who plays the guitar here? — вопрос к подлежащему, без do.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "Where ___ your friends live?",
          options: ["do", "does", "are"],
          answer: "do",
          why: "Friends — множественное число, поэтому do; does остаётся для he/she/it.",
        },
        {
          kind: "choice",
          prompt: "What ___ she want for lunch?",
          options: ["does", "do", "is"],
          answer: "does",
          why: "She требует does, и -s переходит именно туда — want остаётся без окончания.",
        },
        {
          kind: "choice",
          prompt: "When ___ the film start?",
          options: ["does", "do", "is"],
          answer: "does",
          why: "The film — это it, значит does; do с третьим лицом единственного числа не ставится.",
        },
        {
          kind: "choice",
          prompt: "Where ___ your parents from?",
          options: ["are", "do", "does"],
          answer: "are",
          why: "From — предлог при be, поэтому вопрос строится без do: where are your parents from.",
        },
        {
          kind: "choice",
          prompt: "What time ___ you get up?",
          options: ["do", "does", "are"],
          answer: "do",
          why: "Get up — смысловой глагол, ему нужен do; are здесь дал бы другое время и другой смысл.",
        },
        {
          kind: "choice",
          prompt: "Why ___ he so tired?",
          options: ["is", "does", "do"],
          answer: "is",
          why: "Tired — прилагательное при be: why is he so tired, вспомогательный do не нужен.",
        },
        {
          kind: "gap",
          prompt: "Where ___ (your sister / work)?",
          answer: "does your sister work",
          why: "Your sister — это she, поэтому does, а work остаётся без -s.",
        },
        {
          kind: "gap",
          prompt: "What ___ (she / do) in the evening?",
          answer: "does she do",
          why: "Does и do рядом нормальны: первый вспомогательный, второй смысловой.",
        },
        {
          kind: "gap",
          prompt: "When ___ (the concert / start)?",
          answer: "does the concert start",
          why: "The concert — единственное число, значит does, а start идёт без окончания.",
        },
        {
          kind: "gap",
          prompt: "Where ___ (be) my keys?",
          answer: "are",
          why: "Keys — множественное, поэтому are; do при be не ставится.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Где ты живёшь?»",
          options: ["Where", "do", "you", "live"],
          answer: "Where do you live",
          why: "Порядок: where, потом do, потом you и глагол — без do получится русская калька.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Когда он приходит домой?»",
          options: ["When", "does", "he", "come", "home"],
          answer: "When does he come home",
          why: "Does стоит перед he, а come уже без -s: окончание забрал вспомогательный глагол.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Почему они опаздывают?»",
          options: ["Why", "are", "they", "late"],
          answer: "Why are they late",
          why: "Late — прилагательное, поэтому нужен be: are встаёт перед they, do не появляется.",
        },
      ],
    },
];
