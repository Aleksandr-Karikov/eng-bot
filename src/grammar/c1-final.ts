import type { TopicDraft } from "./types";

/**
 * Темы C1 — завершение программы: будущее глазами прошлого, тяжёлые
 * относительные придаточные и формальные связки — то, чем на C1 держат
 * длинную мысль в одной фразе и не теряют согласование времён.
 */
export const C1_FINAL: TopicDraft[] = [
  {
    slug: "future-in-past",
    category: "времена",
    title: "Future in the Past",
    level: "C1",
    rule:
      "Future in the Past — не отдельное время, а взгляд на будущее из прошлой точки: would, was/were going to, was/were to. " +
      "После said, told, knew, promised будущее обязательно сдвигается в would: he said he would call. " +
      "Was going to — намерение, которое часто так и не сбылось, а was to + инфинитив — договорённость по плану, расписанию или приказу. " +
      "Ловушка одна: как только главный глагол встал в прошедшее, will рядом с ним звучит как цитата и ломает согласование времён.",
    examples: [
      "He said he would call back after lunch — told/said в прошлом, звонок позже него, поэтому would call.",
      "We were going to rent the flat, but the owner changed his mind — намерение было и не сбылось, отсюда were going to.",
      "The minister was to open the exhibition at six — was to + инфинитив: официальная договорённость, а не личное желание.",
      "I had no idea what would happen next — косвенный вопрос из прошлого, will тут невозможен.",
      "She was to have signed the contract on Monday, but the lawyer fell ill — was to have done: действие должно было случиться и не случилось.",
    ],
    exercises: [
      {
        kind: "gap",
        prompt: "He told me he ___ (sell) the car the following week.",
        answer: "would sell",
        why: "Told отодвигает точку отсчёта в прошлое, поэтому будущее становится would sell. Will sell выдал бы, что слова ещё звучат в настоящем, а sold потерял бы будущее и превратил план в факт.",
      },
      {
        kind: "choice",
        prompt: "We ___ to move to Leeds, but the deal fell through.",
        options: ["were going", "are going", "will go"],
        answer: "were going",
        why: "Fell through — прошедшее, значит и намерение стояло в прошлом: were going to. Are going заставило бы два времени спорить друг с другом.",
      },
      {
        kind: "choice",
        prompt: "The ceremony ___ at noon, but the storm changed everything.",
        options: ["was to take place", "was taking place", "is to take place"],
        answer: "was to take place",
        why: "Was to + инфинитив — церемония должна была начаться, то есть смотрела в будущее из прошлого. Was taking place сказало бы, что она уже шла в полдень.",
      },
      {
        kind: "gap",
        prompt: "The talks ___ (be) to resume on Monday, but both sides walked out.",
        answer: "were",
        why: "The talks — множественное число, значит were to resume. Was споткнулось бы о talks, а are разошлось бы с walked out.",
      },
      {
        kind: "gap",
        prompt: "Nobody knew whether the shop ___ (open) on Sunday.",
        answer: "would open",
        why: "Вопрос задавали в прошлом и о будущем, поэтому would open. Opens привязал бы расписание к моменту речи, хотя спрашивали заранее.",
      },
      {
        kind: "choice",
        prompt: "She promised she ___ the report by Friday.",
        options: ["would finish", "will finish", "finishes"],
        answer: "would finish",
        why: "Promise стоит в прошедшем, поэтому обещание сдвигается в would finish. Will finish звучит как прямая цитата, а finishes вообще не оставляет будущего.",
      },
      {
        kind: "gap",
        prompt: "They ___ (be) going to complain, but the manager apologised first.",
        answer: "were",
        why: "They требует were, и вся фраза держится на прошедшем: намерение пожаловаться осталось нереализованным. Are going to приклеило бы его к настоящему.",
      },
      {
        kind: "choice",
        prompt: "It was clear the deadline ___ impossible to meet.",
        options: ["was going to be", "is going to be", "will be"],
        answer: "was going to be",
        why: "It was clear задаёт прошлую точку зрения, поэтому was going to be. Is going to be — типичная калька с русского «ясно было, что дедлайн будет нереальным».",
      },
      {
        kind: "gap",
        prompt: "The letter said the results ___ (be) announced in June.",
        answer: "would be",
        why: "Said в прошлом, а объявление позже него, отсюда would be. Will be разорвало бы согласование времён, а were не подходит: результаты объявят, а не они объявляют.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он сказал, что поезд отправится в шесть».",
        options: ["would", "the", "He", "at", "train", "said", "leave", "six"],
        answer: "He said the train would leave at six",
        why: "Said требует сдвига: would leave. Will в такой фразе звучал бы как цитата — его можно оставить, только если поезд отправляется при нас.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Никто не знал, что случится дальше».",
        options: ["knew", "next", "Nobody", "happen", "would", "what"],
        answer: "Nobody knew what would happen next",
        why: "Knew в прошедшем тянет would и в придаточное. Will здесь — калька с русского, где «что случится» звучит одинаково в любом времени.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Королева должна была приехать в полдень».",
        options: ["arrive", "The", "at", "was", "to", "Queen", "noon"],
        answer: "The Queen was to arrive at noon",
        why: "Was to + инфинитив — договорённость по протоколу, а не приезд в процессе. Was arriving сказало бы, что она уже была в пути.",
      },
      {
        kind: "choice",
        prompt: "The letters ___ , but the post office closed early.",
        options: ["were to have been sent", "were to be sent", "were sent"],
        answer: "were to have been sent",
        why: "Почта закрылась раньше, значит действие должно было случиться и не случилось: were to have been sent. Were to be sent оставило бы отправку в будущем, а were sent сказало бы, что письма ушли.",
      },
    ],
  },
  {
    slug: "relative-clauses-advanced",
    category: "порядок слов",
    title: "Non-defining и which = whole clause",
    level: "C1",
    rule:
      "Запятые вокруг relative clause решают, о ком вообще речь: без них придаточное отбирает нужных из множества, с ними — просто добавляет справку. " +
      "После запятой that запрещён, остаются who, which, whose и where. " +
      "Which после запятой часто указывает не на последнее слово, а на всю предыдущую ситуацию, и тогда его не заменить на that. " +
      "Отдельная ловушка — согласование: who берёт число того, кого описывает, поэтому one of those who know, но the only one who knows.",
    examples: [
      "The students who failed the test must retake it — без запятых из всей группы отобрали тех, кто провалился.",
      "The students, who failed the test, must retake it — с запятыми провалились все, и это уже совсем другая новость.",
      "She left at ten, which surprised nobody — which относится ко всему, что она ушла так рано, а не к десяти часам.",
      "The report, which came out yesterday, is wrong — после запятой возможен только which, that туда не поставить.",
      "He is the only one of us who has a key — who описывает именно one, поэтому has в единственном числе.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "My sister, ___ lives in Berlin, is a vet.",
        options: ["who", "that", "which"],
        answer: "who",
        why: "После запятой that невозможен, а which оставил бы сестру предметом. Из оставшихся подходит только who.",
      },
      {
        kind: "choice",
        prompt: "She arrived an hour late, ___ infuriated the client.",
        options: ["which", "that", "what"],
        answer: "which",
        why: "Разозлило клиента не само опоздание на час, а вся ситуация, — поэтому which в роли whole clause. What relative clause вообще не вводит.",
      },
      {
        kind: "gap",
        prompt: "She is one of the few analysts who ___ (understand) the model.",
        answer: "understand",
        why: "Who относится к analysts, то есть ко множеству, поэтому understand без -s. Understands отнёс бы who к one и сузил фразу до одного человека.",
      },
      {
        kind: "gap",
        prompt: "He is the only one of us who ___ (have) a key.",
        answer: "has",
        why: "Only one вытаскивает вперёд единственное число, поэтому has. Have выдало бы, что ключ есть у всех.",
      },
      {
        kind: "choice",
        prompt: "The town ___ I grew up has changed completely.",
        options: ["where", "which", "that"],
        answer: "where",
        why: "Grew up не берёт прямого объекта, значит нужен where. Which потребовал бы in which, а that оставил бы grew up без предлога.",
      },
      {
        kind: "choice",
        prompt: "The author ___ first novel won the prize will speak tonight.",
        options: ["whose", "who's", "which"],
        answer: "whose",
        why: "Первый роман принадлежит автору, поэтому whose. Who's = who is и развалило бы фразу, а which относится к предмету.",
      },
      {
        kind: "gap",
        prompt: "Her two dogs, which ___ (bark) all night, keep me awake.",
        answer: "bark",
        why: "Which здесь относится к dogs, а придаточное не отбирает, а добавляет справку, поэтому present simple и множественное bark. Barks звучал бы так, будто собака одна.",
      },
      {
        kind: "choice",
        prompt: "The reason ___ she gave was unconvincing.",
        options: ["that", "why", "what"],
        answer: "that",
        why: "Gave требует объекта, и that его даёт. Why вводит обстоятельство причины и объектом быть не может, а what в relative clause не ставится.",
      },
      {
        kind: "gap",
        prompt: "The documents which ___ (sign) yesterday are already online.",
        answer: "were signed",
        why: "Документы подписали, а не они подписывали, поэтому пассив were signed. Signed без were оставил бы придаточное без сказуемого.",
      },
      {
        kind: "gap",
        prompt: "The manager, who ___ (join) the firm in 2019, is leaving.",
        answer: "joined",
        why: "In 2019 — точка в прошлом, поэтому joined. Has joined потребовал бы since, а joins разошёлся бы с датой.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Все, кто записался, получили подтверждение».",
        options: ["up", "received", "who", "Everyone", "confirmation", "signed", "a"],
        answer: "Everyone who signed up received a confirmation",
        why: "Who идёт сразу за Everyone, и глагол в придаточном не берёт -s: под who понимается всё множество. Received — уже сказуемое главной части.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Город, где я вырос, изменился».",
        options: ["changed", "The", "I", "where", "town", "grew", "has", "up"],
        answer: "The town where I grew up has changed",
        why: "Where заменяет in which и не требует предлога в конце. Which в этой роли звучало бы как «город, который я вырос».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мужчина, чью машину угнали, позвонил нам».",
        options: ["stolen", "called", "The", "whose", "was", "us", "man", "car"],
        answer: "The man whose car was stolen called us",
        why: "Whose держит при себе существительное car — без него фраза распадается. Who's здесь не помещается: это who is.",
      },
    ],
  },
  {
    slug: "advanced-connectors",
    category: "порядок слов",
    title: "Whereas, albeit, notwithstanding",
    level: "C1",
    rule:
      "Whereas ставит две полные клаузы рядом и подчёркивает контраст, поэтому на стыке почти всегда стоит запятая. " +
      "Albeit сжимает уступку до одного слова или короткого оборота: после него идёт прилагательное, наречие или причастие, но не существительное. " +
      "Notwithstanding — предлог, он берёт существительное, а перед целой клаузой превращается в notwithstanding that. " +
      "Все три живут в письменной речи; в разговоре на их месте обычно but, although и despite.",
    examples: [
      "Whereas the north relies on industry, the south lives off tourism — две полные клаузы, контраст, запятая на стыке обязательна.",
      "The proposal was accepted, albeit reluctantly — после albeit стоит наречие, существительное тут не поставить.",
      "Notwithstanding the delay, the project finished on time — notwithstanding + существительное, по смыслу то же, что despite.",
      "Notwithstanding that the evidence was thin, the jury convicted him — та же связка, но перед целой клаузой, поэтому с that.",
      "He is a competent, albeit uninspired, manager — albeit вклинивается внутрь фразы и берёт прилагательное.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "___ the north relies on industry, the south lives off tourism.",
        options: ["Whereas", "Despite", "Albeit"],
        answer: "Whereas",
        why: "Слева и справа от пропуска — клаузы со своими подлежащими и сказуемыми. Despite потребовал бы существительного, albeit — прилагательного или наречия.",
      },
      {
        kind: "choice",
        prompt: "The proposal was accepted, ___ with some reluctance.",
        options: ["albeit", "although", "despite"],
        answer: "albeit",
        why: "После пропуска идёт оборот без подлежащего и сказуемого — ровно то, что берёт albeit. Although потребовал бы целой клаузы it was met with…",
      },
      {
        kind: "choice",
        prompt: "___ the heavy rain, the match went ahead.",
        options: ["Notwithstanding", "Although", "Whereas"],
        answer: "Notwithstanding",
        why: "Дальше стоит существительное the heavy rain, поэтому нужен предлог notwithstanding. Although и whereas ждут клаузу с подлежащим и глаголом.",
      },
      {
        kind: "choice",
        prompt: "She agreed to help, ___ she had very little time.",
        options: ["although", "albeit", "despite"],
        answer: "although",
        why: "Справа целая клауза she had very little time, поэтому although. Albeit клаузу не берёт, а после despite понадобился бы герундий или существительное.",
      },
      {
        kind: "choice",
        prompt: "The response was quick, ___ not particularly helpful.",
        options: ["albeit", "although", "notwithstanding"],
        answer: "albeit",
        why: "Дальше голая характеристика not particularly helpful без подлежащего. Although потребовал бы it was, а notwithstanding — существительного.",
      },
      {
        kind: "gap",
        prompt: "Notwithstanding that the evidence ___ (be) thin, the jury convicted him.",
        answer: "was",
        why: "That вводит клаузу, и в ней нужно сказуемое: evidence неисчисляемое и единственное, а суд был в прошлом, значит was. Were выдало бы согласование с мнимым множественным.",
      },
      {
        kind: "gap",
        prompt: "Albeit ___ (exhaust) after the flight, she came straight to the meeting.",
        answer: "exhausted",
        why: "После albeit стоит причастие-прилагательное без собственного подлежащего — оно относится к she. Exhausting описал бы полёт, а не её состояние.",
      },
      {
        kind: "gap",
        prompt: "Whereas her earlier novels ___ (sell) in millions, this one barely moved.",
        answer: "sold",
        why: "Novels — множественное, и речь о прошлых тиражах, поэтому sold. Sells привязал бы прежний успех к сегодняшнему дню.",
      },
      {
        kind: "gap",
        prompt: "The deal went through, notwithstanding the objections ___ (raise) by the board.",
        answer: "raised",
        why: "Возражения поднял совет, а не они поднимали, поэтому причастие V3 raised. Raising перевернуло бы роли и сказало бы, что возражали сами возражения.",
      },
      {
        kind: "gap",
        prompt: "The minister refused to resign, notwithstanding ___ (call) from all sides for him to go.",
        answer: "calls",
        why: "Notwithstanding — предлог, поэтому после него существительное calls. Called сделало бы из него глагол и оставило фразу без сказуемого.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Несмотря на задержку, проект завершили вовремя».",
        options: ["finished", "Notwithstanding", "on", "project", "delay,", "the", "the", "time"],
        answer: "Notwithstanding the delay, the project finished on time",
        why: "Notwithstanding стоит прямо перед существительным delay и берёт его без предлога. С although пришлось бы строить целую клаузу, с despite — менять порядок слов.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он пришёл на встречу, хоть и вымотанный».",
        options: ["meeting,", "to", "albeit", "He", "the", "came", "exhausted"],
        answer: "He came to the meeting, albeit exhausted",
        why: "Albeit цепляется к одному слову exhausted, а не к клаузе. Запятая ставится перед всей уступкой, а не после albeit.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «В то время как она любит оперу, он предпочитает джаз».",
        options: ["opera,", "she", "he", "Whereas", "prefers", "loves", "jazz"],
        answer: "Whereas she loves opera, he prefers jazz",
        why: "Whereas соединяет две равноправные клаузы, и запятая стоит на стыке. Без второй клаузы фраза зависла бы на полуслове.",
      },
    ],
  },
];
