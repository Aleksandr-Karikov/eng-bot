import type { TopicDraft } from "./types";

/**
 * Темы C1 — продолжение: выделительные конструкции, причастные обороты,
 * пассив с репортирующими глаголами и хеджинг — то, чем на C1 смягчают
 * утверждение и упаковывают две мысли в одну.
 */
export const C1_MORE: TopicDraft[] = [
  {
    slug: "cleft-sentences",
    category: "порядок слов",
    title: "Cleft sentences: It was… / What…",
    level: "C1",
    rule:
      "Клив-предложение ничего не переносит, а выносит в центр внимания одну часть фразы. " +
      "It-cleft строится так: It was + то, что выделяем + that/who + остальное. " +
      "Wh-cleft начинается с What (или All) и заканчивается глаголом be: What I want is an answer. " +
      "После выделенного человека в it-cleft можно who, но that всегда нейтральнее; " +
      "в wh-cleft be ставят в единственное число, даже если дальше идёт множественное.",
    examples: [
      "It was Marta who spotted the mistake — выделяем человека, поэтому who; с that фраза звучала бы нейтральнее.",
      "What I can't stand is his constant lateness — wh-cleft: сначала What + подлежащее, be идёт в самый конец.",
      "It wasn't until Monday that we heard back — отрицательный it-cleft выделяет время и держит one that после придаточного.",
      "What she did was call the client directly — после was глагол идёт в базовой форме: call, а не called.",
      "All I want is a quiet evening — All вместо What: то же выделение, но разговорнее и категоричнее.",
    ],
    exercises: [
      {
        kind: "gap",
        prompt: "It ___ (be) the noise that woke her at three in the morning.",
        answer: "was",
        why: "Речь о прошедшей ночи, поэтому was. Is отправило бы выделение в настоящее и разошлось бы с woke.",
      },
      {
        kind: "choice",
        prompt: "It was my brother ___ booked the flights.",
        options: ["who", "which", "whose"],
        answer: "who",
        why: "Выделен человек, значит who (или нейтральное that). Which отнесло бы выделение к предмету, а не к брату.",
      },
      {
        kind: "gap",
        prompt: "What worries me ___ (be) the timing of the announcement.",
        answer: "is",
        why: "В wh-cleft be согласуют с What, то есть с единственным числом, хотя после него идёт the timing. Are звучало бы как ошибка человека, который смотрит только на следующее слово.",
      },
      {
        kind: "choice",
        prompt: "___ she did was send a short apology.",
        options: ["What", "It", "That"],
        answer: "What",
        why: "После What … was глагол идёт в базовой форме — send. It в начале потребовало бы was + that перед всей остальной фразой.",
      },
      {
        kind: "choice",
        prompt: "It wasn't ___ Friday that the contract arrived.",
        options: ["until", "before", "since"],
        answer: "until",
        why: "Not until — готовая рамка выделения времени: it wasn't until X that Y. Before сломал бы её, и фраза стала бы простым отрицанием.",
      },
      {
        kind: "gap",
        prompt: "It ___ (be) only last week that I heard the truth.",
        answer: "was",
        why: "Last week тянет за собой прошедшее: was. Is рядом с last week звучит как пересказ, в котором спутаны времена.",
      },
      {
        kind: "choice",
        prompt: "It was the price ___ surprised me, not the service.",
        options: ["that", "what", "who"],
        answer: "that",
        why: "В it-cleft после выделенного предмета идёт that. What здесь — калька с русского «что», а who заставило бы слушателя ждать человека.",
      },
      {
        kind: "gap",
        prompt: "What she actually ___ (want) was a bit of respect.",
        answer: "wanted",
        why: "Глагол внутри What-части согласуется со смыслом: разговор о прошлом, поэтому wanted. Wants выдал бы, что речь о нынешнем желании.",
      },
      {
        kind: "gap",
        prompt: "All he ___ (ask) for is a straight answer.",
        answer: "asks",
        why: "All he asks for is — настоящее, привычное требование, поэтому asks. Asked сузило бы это до одного конкретного разговора.",
      },
      {
        kind: "choice",
        prompt: "___ he said was that he would call back.",
        options: ["All", "It", "That"],
        answer: "All",
        why: "All … was — та же wh-рамка, что и What, но с оттенком «и только это». It в начале потребовало бы was перед that-придаточным.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Всё, что ей нужно, — немного тишины».",
        options: ["is", "of", "All", "silence", "needs", "a", "she", "bit"],
        answer: "All she needs is a bit of silence",
        why: "All + подлежащее + глагол, и только потом be и то, что выделяем. Если начать с is, слушатель не поймёт, о чём вообще речь.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Что меня удивило — это его спокойный тон».",
        options: ["was", "tone", "What", "his", "me", "calm", "surprised"],
        answer: "What surprised me was his calm tone",
        why: "Wh-cleft держит be в середине, между двумя частями: сначала факт, потом то, что выделяем. Перенос was в начало превратил бы фразу в вопрос.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Именно дедлайн всех вымотал».",
        options: ["that", "everyone", "It", "exhausted", "was", "the", "deadline"],
        answer: "It was the deadline that exhausted everyone",
        why: "It was + выделенное + that + остальное. That здесь обязателен: без него две половины фразы просто повиснут рядом.",
      },
    ],
  },
  {
    slug: "participle-clauses",
    category: "формы глаголов",
    title: "Причастные обороты",
    level: "C1",
    rule:
      "Причастный оборот заменяет целое придаточное и делает фразу плотнее. " +
      "Форма на -ing описывает активное действие: Walking home, I saw him = While I was walking home. " +
      "Форма на -ed (V3) — пассив или уже свершившееся: Written in 1920, the novel… = The novel, which was written in 1920. " +
      "Главная ловушка — подлежащее: оно должно совпадать у оборота и у главной части, иначе получается " +
      "«подвешенное» причастие, и читатель приписывает действие не тому человеку.",
    examples: [
      "Walking back, I noticed the lights were off — я шёл и я заметил: подлежащее одно, оборот законен.",
      "Written in 1920, the novel still reads fresh — пассив: роман написали, сам он не писал.",
      "Having finished the report, she went home — having + V3, если первое действие закончилось до второго.",
      "The man standing by the door is my lawyer — оборот заменил who is standing и убрал лишний глагол.",
      "Exhausted by the trip, we went straight to bed — V3 описывает состояние того же подлежащего we.",
    ],
    exercises: [
      {
        kind: "gap",
        prompt: "___ (walk) back from the station, I ran into Anna.",
        answer: "Walking",
        why: "Иду я и встречаю я — подлежащее совпадает, значит активная форма на -ing. Walked приписало бы ходьбу кому-то другому.",
      },
      {
        kind: "choice",
        prompt: "___ in a hurry, the letter had several mistakes.",
        options: ["Written", "Writing", "Wrote"],
        answer: "Written",
        why: "Письмо написали, оно не писало само, — отсюда пассивная форма V3. Writing сделало бы письмо автором действия.",
      },
      {
        kind: "choice",
        prompt: "___ all the emails, he switched off his laptop.",
        options: ["Having answered", "Answering", "Answered"],
        answer: "Having answered",
        why: "Почту он разобрал до того, как выключил ноутбук, — это having + V3. Answering смешало бы два действия в одно время.",
      },
      {
        kind: "gap",
        prompt: "The file ___ (lie) on the desk belongs to Marta.",
        answer: "lying",
        why: "Оборот заменяет which is lying: файл лежит сейчас, действие активное. Lain звучало бы как состояние из учебника, а не как факт на столе.",
      },
      {
        kind: "gap",
        prompt: "The candidates ___ (interview) yesterday are still waiting.",
        answer: "interviewed",
        why: "Кандидатов опрашивали, а не они опрашивали, — значит V3. Interviewing перевернуло бы роли и сказало бы, что это они проводят собеседования.",
      },
      {
        kind: "choice",
        prompt: "___ by the news, she cancelled the meeting.",
        options: ["Shocked", "Shocking", "Shock"],
        answer: "Shocked",
        why: "Новость шокировала её, поэтому нужен V3. Shocking описал бы саму новость, и подлежащее перестало бы совпадать с оборотом.",
      },
      {
        kind: "gap",
        prompt: "___ (not / know) the answer, he kept quiet.",
        answer: "Not knowing",
        why: "Отрицание ставится перед причастием: not knowing. Not knew или didn't knowing — уже не причастие, а обломки придаточного.",
      },
      {
        kind: "gap",
        prompt: "___ (finish) the call, she turned to us.",
        answer: "Having finished",
        why: "Звонок закончился раньше, чем она повернулась, поэтому having + V3. Finishing склеило бы оба действия в один момент.",
      },
      {
        kind: "choice",
        prompt: "The children, ___ by the announcement, started cheering.",
        options: ["excited", "exciting", "excite"],
        answer: "excited",
        why: "Объявление взволновало детей — пассив, V3. Exciting сказало бы, что волновались они сами по себе, то есть что дети будоражат других.",
      },
      {
        kind: "choice",
        prompt: "___ for the bus, I realised I'd left my wallet at home.",
        options: ["Waiting", "Waited", "To wait"],
        answer: "Waiting",
        why: "Ждал автобус я и понял тоже я — подлежащее одно, нужна активная форма. Waited не образует оборота и оставил бы фразу без подлежащего у первого действия.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Люди, ждущие на улице, — мои коллеги».",
        options: ["outside", "are", "The", "colleagues", "waiting", "my", "people"],
        answer: "The people waiting outside are my colleagues",
        why: "Оборот стоит сразу после существительного, которое описывает, и обходится без who are. Are в середине разорвало бы пару people … colleagues.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Письмо, написанное в 1920 году, так и не опубликовали».",
        options: ["was", "The", "1920", "written", "letter", "never", "in", "published"],
        answer: "The letter written in 1920 was never published",
        why: "Written идёт сразу за letter, а перед ним нет запятой: оборот уточняет, о каком письме речь. Published в конце — это уже сказуемое главной части.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он сидел у окна, наблюдая за дождём».",
        options: ["by", "He", "watching", "a", "rain", "sat", "window", "the"],
        answer: "He sat by a window watching the rain",
        why: "Оборот в конце цепляется к тому же подлежащему He: он сидел и он же наблюдал. Watching в начале потребовало бы запятой и звучало бы книжнее.",
      },
    ],
  },
  {
    slug: "passive-reporting",
    category: "выбор слова",
    title: "It is said that… / He is believed to…",
    level: "C1",
    rule:
      "Когда источник сообщения неважен или его принято не называть, репортирующий глагол уходит в пассив. " +
      "It is said that he left — безличная рамка: сообщаем факт, не указывая, кто сказал. " +
      "He is said to have left — то же самое, но подлежащим становится сам человек. " +
      "Для события, которое было раньше момента речи, нужен перфектный инфинитив: to have left, а не to leave. " +
      "Так же работают think, believe, report, expect, allege.",
    examples: [
      "It is said that the firm is losing clients — источник не назван, и это нормально для отчёта и новости.",
      "He is said to have left the country — уехал он раньше, чем об этом говорят, поэтому to have left.",
      "The drug is believed to cause headaches — утверждение о настоящем, значит простой инфинитив to cause.",
      "She is expected to resign tomorrow — ожидание смотрит в будущее без всякого will.",
      "It was reported that talks had collapsed — сообщили в прошлом о ещё более раннем событии, отсюда had collapsed.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "He ___ to have left the country last month.",
        options: ["is said", "is saying", "says"],
        answer: "is said",
        why: "Говорят не о том, что он говорит, а о нём самом, поэтому пассив. Is saying перевернуло бы роли и сделало его источником слухов.",
      },
      {
        kind: "gap",
        prompt: "The company ___ (report) to be losing money.",
        answer: "is reported",
        why: "Сообщают о компании, а не она сообщает, — пассив в единственном числе. Reports оставило бы фразу без объекта: кому она сообщает?",
      },
      {
        kind: "gap",
        prompt: "The drug ___ (believe) to cause headaches.",
        answer: "is believed",
        why: "Верят не лекарству, а в то, что оно вызывает головную боль, поэтому пассив. Believes сделало бы лекарство верующим.",
      },
      {
        kind: "choice",
        prompt: "It ___ that the talks have collapsed.",
        options: ["is thought", "is thinking", "thinks"],
        answer: "is thought",
        why: "Безличная рамка it is thought that не называет, кто думает. Is thinking требовало бы живого подлежащего, а thinks — конкретного человека.",
      },
      {
        kind: "choice",
        prompt: "The minister is expected ___ his resignation tomorrow.",
        options: ["to announce", "announcing", "announce"],
        answer: "to announce",
        why: "После be expected идёт to + инфинитив, потому что это конструкция с подлежащим-объектом ожидания. Announcing сломал бы её и превратил в причастие.",
      },
      {
        kind: "gap",
        prompt: "The manuscript ___ (say) to date from the twelfth century.",
        answer: "is said",
        why: "Рукопись не говорит, о ней говорят, — пассив. Says звучало бы как цитата из рукописи, а не как оценка учёных.",
      },
      {
        kind: "gap",
        prompt: "Two climbers ___ (think) to be missing after the storm.",
        answer: "are thought",
        why: "Подлежащее во множественном числе, значит are thought. Is thought споткнулось бы о two climbers в самом начале фразы.",
      },
      {
        kind: "choice",
        prompt: "It was reported that the talks ___ collapsed days earlier.",
        options: ["had", "have", "were"],
        answer: "had",
        why: "Сообщение в прошлом, а обвал случился ещё раньше, поэтому Past Perfect. Have сдвинуло бы событие к моменту речи.",
      },
      {
        kind: "gap",
        prompt: "He ___ (believe) to have been working there for years.",
        answer: "is believed",
        why: "Пассив от believe, и to have been working подчёркивает, что работа длилась до сих пор. Believes сделало бы его автором мнения.",
      },
      {
        kind: "choice",
        prompt: "The painting ___ to be worth millions.",
        options: ["is believed", "is believing", "believes"],
        answer: "is believed",
        why: "Believe не употребляется в Continuous, а картине не припишешь веру: нужен пассив. Is believing — типичная попытка сделать глагол мнения длительным.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Считается, что фирма в беде».",
        options: ["to", "trouble", "The", "believed", "in", "is", "be", "firm"],
        answer: "The firm is believed to be in trouble",
        why: "Пассив is believed плюс простой инфинитив to be: положение дел относится к настоящему. To have been сказало бы, что беда уже позади.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Говорят, что она слишком много работает».",
        options: ["works", "It", "too", "that", "said", "hard", "is", "she"],
        answer: "It is said that she works too hard",
        why: "Безличная рамка it is said that сохраняет обычный порядок слов в придаточном. Без that две части слиплись бы и фраза стала бы нечитаемой.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Ожидается, что они приедут в пятницу».",
        options: ["arrive", "They", "on", "expected", "Friday", "to", "are"],
        answer: "They are expected to arrive on Friday",
        why: "Ожидание смотрит в будущее, поэтому to arrive без have и без will. Are expected to have arrived сказало бы, что они уже приехали.",
      },
    ],
  },
  {
    slug: "hedging",
    category: "выбор слова",
    title: "Seem / appear / tend to",
    level: "C1",
    rule:
      "Хеджинг — это страховка: утверждение формулируют так, чтобы его нельзя было предъявить тебе как факт. " +
      "Seem и appear опираются на впечатление от того, что видно, и правды не обещают. " +
      "Tend to говорит о статистике и повторяющемся поведении, а не об одном случае. " +
      "Be likely to — самый сильный из этих оборотов: это прогноз, а не впечатление. " +
      "Ловушка в том, что каждая форма обещает разное, и неверная превращает догадку в утверждение.",
    examples: [
      "He seems to have forgotten the meeting — впечатление о прошлом, поэтому seem + to have done.",
      "The results appear to support our theory — appear книжнее seem и уместнее в отчёте.",
      "Managers tend to trust numbers — tend to о повторяющемся поведении целой группы, а не об одном человеке.",
      "Prices are likely to rise next quarter — прогноз, который можно оспорить, но нельзя назвать обещанием.",
      "It seems that nobody checked the figures — безличный it seems, когда виноват не конкретный человек, а порядок дел.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "He ___ to have forgotten about the meeting.",
        options: ["seems", "is seeming", "seem"],
        answer: "seems",
        why: "Подлежащее he требует -s, а seem не бывает в Continuous. Is seeming — типичная попытка «усилить» глагол впечатления, которая выдаёт перевод с русского.",
      },
      {
        kind: "gap",
        prompt: "The data ___ (appear) to confirm the pattern.",
        answer: "appear",
        why: "Data в научной речи — множественное число, поэтому appear без -s. Appears выдало бы, что автор не чувствует согласования с data.",
      },
      {
        kind: "choice",
        prompt: "Children ___ to imitate their parents.",
        options: ["tend", "tends", "are tending"],
        answer: "tend",
        why: "Речь о целом классе людей и типичном поведении, поэтому tend to без временных форм. Tends споткнулось бы о множественное children.",
      },
      {
        kind: "choice",
        prompt: "She is ___ to win the nomination.",
        options: ["likely", "possible", "probable"],
        answer: "likely",
        why: "Только likely берёт конструкцию be likely to + инфинитив. Possible и probable требуют безличного it is possible that…, и с подлежащим she они невозможны.",
      },
      {
        kind: "gap",
        prompt: "It ___ (seem) that the office is closed on Mondays.",
        answer: "seems",
        why: "Безличный оборот it seems that берёт единственное число, хотя смысл — общее правило. Seem здесь выглядело бы просто опечаткой.",
      },
      {
        kind: "gap",
        prompt: "The plan ___ (seem) to be working.",
        answer: "seems",
        why: "Впечатление от нынешнего положения дел: seem + to be doing. Seemed сдвинуло бы оценку в прошлое, хотя план работает сейчас.",
      },
      {
        kind: "choice",
        prompt: "The minister ___ to have misled the committee.",
        options: ["appears", "is appearing", "appear"],
        answer: "appears",
        why: "Один человек — значит -s, и никакого Continuous: appear здесь глагол впечатления, а не «появляться на сцене». To have misled относит ошибку к прошлому.",
      },
      {
        kind: "gap",
        prompt: "People ___ (tend) to remember the beginning and the end.",
        answer: "tend",
        why: "Обобщение о людях вообще: tend to без артикля и без -s. Tends сузило бы утверждение до одного человека.",
      },
      {
        kind: "choice",
        prompt: "___ to be a mistake in the invoice.",
        options: ["There seems", "It seems", "There seem"],
        answer: "There seems",
        why: "Речь о наличии ошибки, поэтому нужен there, и он же подлежащее для seems. It seems to be a mistake значило бы «это, видимо, ошибка», а не «в счёте, похоже, ошибка».",
      },
      {
        kind: "choice",
        prompt: "On average, introverts ___ to prefer written communication.",
        options: ["tend", "are likely", "seem"],
        answer: "tend",
        why: "On average — сигнал статистики, а не одного случая, поэтому tend to. Are likely to говорило бы о вероятности конкретного человека, а seem — о впечатлении от него.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он, похоже, хорошо знает город».",
        options: ["the", "know", "He", "well", "to", "city", "seems"],
        answer: "He seems to know the city well",
        why: "Seem + to + инфинитив, и -s на seem, потому что подлежащее he. Seems to knowing или seems know — уже не эта конструкция.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Погода, вероятно, изменится завтра».",
        options: ["likely", "The", "tomorrow", "is", "to", "weather", "change"],
        answer: "The weather is likely to change tomorrow",
        why: "Be likely to + инфинитив — самый сильный прогноз из всех хеджей. Likely не берёт that-придаточного, поэтому change стоит после to.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Похоже, они потеряли чек».",
        options: ["lost", "They", "the", "to", "receipt", "appear", "have"],
        answer: "They appear to have lost the receipt",
        why: "Чек потеряли раньше момента речи, поэтому appear + to have lost. To lose отправило бы потерю в будущее и сделало фразу бессмысленной.",
      },
    ],
  },
];
