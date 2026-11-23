import type { TopicDraft } from "./types";

/**
 * Темы A2: степени сравнения и будущее. Превосходная степень, will для решений и обещаний и
 * Past Continuous стоят рядом, потому что во всех трёх русскоязычный ученик уверенно говорит
 * по-своему: «самый дорогой» через most + -est, «will to do» с лишним to и «я смотрел» там,
 * где англичанин скажет «я смотрел в тот момент».
 */
export const A2_ADJECTIVES_FUTURE: TopicDraft[] = [
  {
      slug: "superlatives",
      category: "формы глаголов",
      title: "Превосходная степень",
      level: "A2",
      rule:
        "Превосходная степень — «самый»: короткое слово берёт the + -est (tall → the tallest), длинное — " +
        "the most (the most comfortable). Артикль the перед ней почти обязателен — такой предмет один. " +
        "Два способа вместе не соединяются: the most expensive, а не the most expensivest. " +
        "Неправильные: good → the best, bad → the worst, far → the furthest.",
      examples: [
        "This is the tallest building in the city — короткое слово: the + -est.",
        "That's the most expensive phone in the shop — длинное слово: только the most.",
        "It was the worst day of my life — bad → the worst.",
        "She is the best singer here — good → the best.",
        "He's the youngest player on the team — young → the youngest.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "This is ___ hotel in the city.",
          options: ["the most expensive", "the most expensivest", "the expensivest"],
          answer: "the most expensive",
          why: "Expensive — длинное слово: превосходная только через the most, а -est рядом с most лишний.",
        },
        {
          kind: "gap",
          prompt: "Everest is ___ (high) mountain in the world.",
          answer: "the highest",
          why: "High — один слог, значит the + -est; most здесь не нужен.",
        },
        {
          kind: "gap",
          prompt: "February is ___ (short) month of the year.",
          answer: "the shortest",
          why: "Short — один слог: -est, и the перед ним не забываем — месяц такой один.",
        },
        {
          kind: "choice",
          prompt: "That was ___ day of my holiday.",
          options: ["the happiest", "the most happy", "happiest"],
          answer: "the happiest",
          why: "Happy кончается на -y: -y меняется на -i и берёт -est, а не most; вариант без the неполный.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Это самый интересный фильм года».",
          options: ["This", "is", "the", "most", "interesting", "film", "of", "the", "year"],
          answer: "This is the most interesting film of the year",
          why: "Interesting — длинное слово: the most + прилагательное, прилагательное не меняется.",
        },
        {
          kind: "gap",
          prompt: "What's ___ (good) way to learn a language?",
          answer: "the best",
          why: "Good — неправильное: превосходная the best, никаких goodest или most good.",
        },
        {
          kind: "choice",
          prompt: "It was ___ match of the season.",
          options: ["the worst", "the baddest", "the most bad"],
          answer: "the worst",
          why: "Bad — неправильное: the worst; baddest и most bad — калька с русского «самый плохой».",
        },
        {
          kind: "gap",
          prompt: "She is ___ (young) student in the group.",
          answer: "the youngest",
          why: "Young — один слог, значит -est; the показывает, что она такая одна.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Он самый быстрый бегун в команде».",
          options: ["He", "is", "the", "fastest", "runner", "in", "the", "team"],
          answer: "He is the fastest runner in the team",
          why: "Fast — один слог: the fastest, и прилагательное стоит перед существительным.",
        },
        {
          kind: "choice",
          prompt: "She is ___ student in our group.",
          options: ["the most talented", "the most talentedest", "most talented"],
          answer: "the most talented",
          why: "Most уже делает слово превосходным — -est к нему не добавляется, а the остаётся.",
        },
        {
          kind: "gap",
          prompt: "Which is ___ (big) city in Russia?",
          answer: "the biggest",
          why: "Big — один слог с краткой гласной: согласная удваивается, big → the biggest.",
        },
        {
          kind: "choice",
          prompt: "That was ___ book I've read this year.",
          options: ["the most boring", "the boringest", "most boring"],
          answer: "the most boring",
          why: "Boring — два слога, превосходная через the most; форма boringest в норме не образуется.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она самая высокая в классе».",
          options: ["She", "is", "the", "tallest", "in", "the", "class"],
          answer: "She is the tallest in the class",
          why: "После превосходной существительное можно не повторять: the tallest = «самая высокая».",
        },
      ],
    },
  {
      slug: "future-will",
      category: "времена",
      title: "Will: решения и обещания",
      level: "A2",
      rule:
        "Will + глагол в обычной форме, без to: I will call, she will come. Will нужен, когда решение " +
        "принимается прямо сейчас, на глазах собеседника: звонок в дверь — I'll get it. Ещё will — это " +
        "обещания и предложения помощи: I'll help you. Заранее обдуманные планы идут через going to " +
        "(I'm going to visit my parents) — это отдельная тема, и отрицание от will — won't.",
      examples: [
        "The phone is ringing — I'll answer it — решил в эту секунду.",
        "I'll help you with those bags — предложение помощи.",
        "I won't be late, I promise — обещание, отрицание через won't.",
        "Will you open the window, please? — просьба через will.",
        "We're going to move house in May — это план, поэтому going to, а не will.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "Somebody is knocking at the door. I ___ it.",
          options: ["'ll open", "will to open", "open"],
          answer: "'ll open",
          why: "Решение принято в момент речи — will (сокращённо 'll), и после него глагол без to.",
        },
        {
          kind: "gap",
          prompt: "I promise I ___ (help) you with the move.",
          answer: "will help",
          why: "I promise — это обещание, значит will; после will глагол идёт в обычной форме.",
        },
        {
          kind: "order",
          prompt: "Собери обещание: «Я позвоню тебе вечером».",
          options: ["I", "will", "call", "you", "this", "evening"],
          answer: "I will call you this evening",
          why: "Обещание строится как will + call, и обстоятельство времени в конце.",
        },
        {
          kind: "choice",
          prompt: "Don't worry, I ___ tell anyone.",
          options: ["won't", "don't", "am not"],
          answer: "won't",
          why: "Отрицательное обещание о будущем: won't (will not), а не don't.",
        },
        {
          kind: "gap",
          prompt: "It's cold. I ___ (close) the window.",
          answer: "will close",
          why: "Решение возникает прямо сейчас, от холода — will, а не going to.",
        },
        {
          kind: "choice",
          prompt: "She will ___ us at the airport.",
          options: ["meet", "to meet", "meets"],
          answer: "meet",
          why: "После will нет ни to, ни -s: she will meet — вспомогательный глагол уже несёт всё.",
        },
        {
          kind: "gap",
          prompt: "I ___ (not / forget) your birthday again.",
          answer: "won't forget",
          why: "Обещание в отрицании: won't + forget, и глагол без -s и без to.",
        },
        {
          kind: "order",
          prompt: "Собери обещание: «Я никому не скажу».",
          options: ["I", "won't", "tell", "anyone"],
          answer: "I won't tell anyone",
          why: "Отрицание будущего — won't, а tell остаётся в обычной форме.",
        },
        {
          kind: "choice",
          prompt: "That bag looks heavy. I ___ it for you.",
          options: ["'ll carry", "carry", "will to carry"],
          answer: "'ll carry",
          why: "Предложение помощи в момент речи — will; to после will не ставится.",
        },
        {
          kind: "gap",
          prompt: "Sit down, I ___ (make) you a cup of tea.",
          answer: "will make",
          why: "Гость только что пришёл, чай предложен сейчас — will, а не запланированное going to.",
        },
        {
          kind: "order",
          prompt: "Собери просьбу: «Ты поможешь мне с домашним заданием?»",
          options: ["Will", "you", "help", "me", "with", "my", "homework"],
          answer: "Will you help me with my homework",
          why: "Просьба — вопрос с will впереди и глаголом help без to.",
        },
        {
          kind: "choice",
          prompt: "We ___ a taxi — it's late.",
          options: ["'ll take", "will to take", "will takes"],
          answer: "'ll take",
          why: "Решили сию секунду, глядя на часы: will; после will ни to, ни -s.",
        },
        {
          kind: "gap",
          prompt: "Don't worry, he ___ (be) back in ten minutes.",
          answer: "will be",
          why: "Will работает и с be: после него be, а не to be и не is.",
        },
      ],
    },
  {
      slug: "past-continuous-a2",
      category: "времена",
      title: "Past Continuous",
      level: "A2",
      rule:
        "Past Continuous — was/were + глагол с -ing: действие шло в какой-то момент в прошлом. " +
        "Was идёт с I, he, she, it, were — с you, we, they. Отрицание — wasn't / weren't + -ing, " +
        "вопрос — Was/Were + подлежащее + -ing. Часто это просто фон рассказа: It was raining, " +
        "and people were hurrying home.",
      examples: [
        "At eight o'clock I was still working — действие шло в тот момент.",
        "The kids were playing in the yard — фон, что происходило вокруг.",
        "They weren't listening to the guide — отрицание через weren't.",
        "Were you sleeping at midnight? — вопрос: were + подлежащее + -ing.",
        "It was snowing, and people were hurrying home — обстановка в рассказе.",
      ],
      exercises: [
        {
          kind: "gap",
          prompt: "At nine o'clock yesterday I ___ (watch) a film.",
          answer: "was watching",
          why: "Точка в прошлом, действие в ней шло — was + watching; I берёт was.",
        },
        {
          kind: "choice",
          prompt: "They ___ football all morning.",
          options: ["were playing", "was playing", "were play"],
          answer: "were playing",
          why: "They — множественное число, значит were; и без -ing форма неполная.",
        },
        {
          kind: "gap",
          prompt: "He ___ (not / feel) well, so he stayed in bed.",
          answer: "wasn't feeling",
          why: "Отрицание: wasn't + feeling; he — единственное число, поэтому wasn't.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Я готовил ужин в шесть».",
          options: ["I", "was", "cooking", "dinner", "at", "six"],
          answer: "I was cooking dinner at six",
          why: "Действие в процессе в шесть часов: was + cooking, и время ставим в конец.",
        },
        {
          kind: "choice",
          prompt: "___ you working at ten yesterday?",
          options: ["Were", "Was", "Did"],
          answer: "Were",
          why: "Вопрос в Past Continuous: were + you + -ing; did здесь не нужен.",
        },
        {
          kind: "gap",
          prompt: "The children ___ (swim) in the pool at noon.",
          answer: "were swimming",
          why: "Children — множественное, поэтому were + swimming.",
        },
        {
          kind: "choice",
          prompt: "It ___ hard, so we stayed at home.",
          options: ["was raining", "were raining", "was rain"],
          answer: "was raining",
          why: "It — единственное число и погода как фон, значит was raining.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Что ты делал в восемь?»",
          options: ["What", "were", "you", "doing", "at", "eight"],
          answer: "What were you doing at eight",
          why: "Вопросительное слово, потом were + you + doing.",
        },
        {
          kind: "gap",
          prompt: "He ___ (not / work) yesterday, he was ill.",
          answer: "wasn't working",
          why: "Wasn't — для he; -ing остаётся, потому что речь о процессе, а не о факте.",
        },
        {
          kind: "choice",
          prompt: "At that time my parents ___ dinner in the kitchen.",
          options: ["were having", "was having", "had"],
          answer: "were having",
          why: "Parents — множественное: were having; had — просто факт, без «в тот момент».",
        },
        {
          kind: "order",
          prompt: "Собери отрицание: «Она не спала в тот момент».",
          options: ["She", "wasn't", "sleeping", "at", "that", "moment"],
          answer: "She wasn't sleeping at that moment",
          why: "Wasn't + sleeping для she, а at that moment держит нас в прошлом процессе.",
        },
        {
          kind: "gap",
          prompt: "We ___ (wait) for the bus at seven.",
          answer: "were waiting",
          why: "We — множественное, значит were; и процесс в семь часов налицо.",
        },
        {
          kind: "choice",
          prompt: "Sorry, I ___ to you.",
          options: ["wasn't listening", "didn't listening", "wasn't listen"],
          answer: "wasn't listening",
          why: "Past Continuous с -ing: после wasn't идёт listening, а didn't с -ing не сочетается.",
        },
      ],
    },
];
