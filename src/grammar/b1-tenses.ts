import type { TopicDraft } from "./types";

/**
 * Темы уровня B1 — времена. Контент ручной: проверка ответа идёт сравнением строк,
 * поэтому ошибка в контенте значит «человек ответил верно, а бот сказал неверно».
 *
 * Набор из четырёх тем закрывает главный барьер B1: человек уже знает формы,
 * но путает, когда какое время уместно. Поэтому у каждой темы `why` объясняет выбор,
 * а не пересказывает правило.
 */
export const B1_TENSES: TopicDraft[] = [
  {
    slug: "present-perfect",
    category: "времена",
    title: "Present Perfect: результат к сейчас",
    level: "B1",
    rule:
      "Present Perfect — это have/has + третья форма глагола (V3): I have lost my keys, she has finished the report. " +
      "Действие было раньше, но время не важно — важен его результат в настоящий момент: ключи потерял когда-то, " +
      "а войти не могу сейчас. Со словом for говорят, сколько длится (for three years), с since — с какого момента (since 2020). " +
      "Точное прошедшее время (yesterday, in 2019, two days ago) с ним не ставят — для этого есть Past Simple.",
    examples: [
      "I have lost my keys — результат: ключей нет сейчас.",
      "She has just finished the report — действие только что закончилось, результат налицо.",
      "We have lived here since 2019 — since ставит точку начала, живём до сих пор.",
      "He has worked at this company for five years — for говорит о длительности.",
      "Have you ever been to Japan? — вопрос про опыт за всю жизнь, без конкретной даты.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I ___ my passport, so I can't travel tomorrow.",
        options: ["have lost", "lost", "lose"],
        answer: "have lost",
        why: "Важен результат сейчас — паспорта нет, поэтому have + V3.",
      },
      {
        kind: "gap",
        prompt: "She ___ (work) here since 2020.",
        answer: "has worked",
        why: "Since 2020 — начало периода, который длится до сих пор: she → has worked.",
      },
      {
        kind: "choice",
        prompt: "We ___ in this flat for ten years.",
        options: ["have lived", "live", "are living"],
        answer: "have lived",
        why: "For ten years — длительность до настоящего момента, значит have lived.",
      },
      {
        kind: "gap",
        prompt: "He ___ (not / start) the report yet.",
        answer: "hasn't started",
        why: "Yet в конце значит «пока нет», а это Present Perfect: hasn't + V3.",
      },
      {
        kind: "choice",
        prompt: "___ you finished the task?",
        options: ["Have", "Has", "Did"],
        answer: "Have",
        why: "С you идёт have, а результат нужен сейчас — поэтому не Did.",
      },
      {
        kind: "gap",
        prompt: "They ___ (be) to Italy twice.",
        answer: "have been",
        why: "Опыт без конкретной даты: have + been (V3 от be), а не were.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она только что отправила письмо».",
        options: ["She", "has", "just", "sent", "the", "email"],
        answer: "She has just sent the email",
        why: "Just ставится между has и V3, и письмо уже ушло — результат к сейчас.",
      },
    ],
  },
  {
    slug: "present-perfect-vs-past-simple",
    category: "времена",
    title: "Present Perfect или Past Simple",
    level: "B1",
    rule:
      "Вопрос простой: названо ли время. Если в предложении есть yesterday, last week, in 2019, two days ago — " +
      "это Past Simple, потому что действие привязано к точке в прошлом: I saw Anna yesterday. " +
      "Если время не названо и неважно, а важен результат или опыт — Present Perfect: I have seen this film. " +
      "Проверка на ходу: если собеседник спросил «когда?» и ответ на этот вопрос есть — значит Past Simple.",
    examples: [
      "I saw Anna yesterday — время названо, Past Simple.",
      "I have seen this film — когда именно, неважно, важен опыт.",
      "We have moved to a new office — офис новый сейчас, время не названо.",
      "We moved to a new office in June — in June, значит Past Simple.",
      "Have you ever eaten sushi? — про опыт; Did you eat sushi there? — про конкретный случай в прошлом.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "She ___ her first job in 2021.",
        options: ["started", "has started", "starts"],
        answer: "started",
        why: "Год в прошлом назван прямо — это точка на шкале, значит Past Simple.",
      },
      {
        kind: "gap",
        prompt: "I ___ (already / send) the email, so you don't need to do it.",
        answer: "have already sent",
        why: "Already и «не нужно делать сейчас» — результат к настоящему, значит Present Perfect.",
      },
      {
        kind: "gap",
        prompt: "She ___ (see) this film three times.",
        answer: "has seen",
        why: "Три раза за всю жизнь, без даты — это опыт, значит has seen.",
      },
      {
        kind: "gap",
        prompt: "We ___ (meet) at a conference back in 2019.",
        answer: "met",
        why: "Back in 2019 — привязка к прошлому, поэтому Past Simple: met.",
      },
      {
        kind: "choice",
        prompt: "___ you watch the match last night?",
        options: ["Did", "Have", "Were"],
        answer: "Did",
        why: "Last night — конкретное время, вопрос строится через Did + глагол.",
      },
      {
        kind: "gap",
        prompt: "He ___ (live) in Berlin for two years, then moved to Prague.",
        answer: "lived",
        why: "Дальше он переехал — период закончился, поэтому Past Simple, хотя есть for two years.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я видел этот фильм вчера вечером».",
        options: ["I", "saw", "this", "film", "last", "night"],
        answer: "I saw this film last night",
        why: "Last night — время названо, поэтому saw, а не have seen.",
      },
    ],
  },
  {
    slug: "past-continuous",
    category: "времена",
    title: "Past Continuous: процесс в прошлом",
    level: "B1",
    rule:
      "Past Continuous — это was/were + глагол с -ing: I was working, they were waiting. Он показывает процесс, " +
      "который шёл в какой-то момент прошлого: At 8 p.m. I was cooking dinner. Часто он работает в паре с Past Simple: " +
      "длинное действие — фон (I was cooking), короткое его прервало (the phone rang). " +
      "После while обычно идёт процесс, после when — короткое событие.",
    examples: [
      "At 8 p.m. I was cooking dinner — процесс в конкретный момент прошлого.",
      "She was driving to work when her phone rang — процесс и звонок, который его прервал.",
      "While she was studying, her brother was playing games — два процесса одновременно.",
      "They were waiting for the bus at seven — was/were + -ing, момент указан.",
      "I didn't hear you because I was listening to music — причина в том, что происходило тогда.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "At 9 p.m. yesterday I ___ dinner.",
        options: ["was cooking", "cooked", "cook"],
        answer: "was cooking",
        why: "Точный момент в прошлом, действие в процессе — was + -ing.",
      },
      {
        kind: "gap",
        prompt: "They ___ (wait) at the airport when the flight was cancelled.",
        answer: "were waiting",
        why: "They требует were, и ожидание было фоном к отмене рейса.",
      },
      {
        kind: "choice",
        prompt: "We were having dinner when someone ___ at the door.",
        options: ["knocked", "was knocking", "knocks"],
        answer: "knocked",
        why: "Стук был коротким и прервал ужин — Past Simple, не процесс.",
      },
      {
        kind: "gap",
        prompt: "While I ___ (prepare) the slides, the internet went down.",
        answer: "was preparing",
        why: "While плюс длительная подготовка, которую прервало падение связи.",
      },
      {
        kind: "choice",
        prompt: "We ___ TV when the lights went out.",
        options: ["were watching", "watched", "watch"],
        answer: "were watching",
        why: "Просмотр был фоном, а свет выключился внезапно — Past Continuous.",
      },
      {
        kind: "gap",
        prompt: "What ___ (you / do) when I called you?",
        answer: "were you doing",
        why: "Вопрос в Past Continuous: were + you + глагол с -ing, звонок прервал процесс.",
      },
      {
        kind: "gap",
        prompt: "Sorry, I ___ (not / listen) to you.",
        answer: "wasn't listening",
        why: "Отрицание процесса в прошлом: wasn't + глагол с -ing.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я шёл на встречу, когда позвонил клиент».",
        options: ["I", "was", "walking", "to", "the", "meeting", "when", "a", "client", "called"],
        answer: "I was walking to the meeting when a client called",
        why: "Долгий процесс в прошлом — was walking, короткий звонок вклинился после when.",
      },
    ],
  },
  {
    slug: "future-forms",
    category: "времена",
    title: "Будущее: will, going to, Present Continuous",
    level: "B1",
    rule:
      "will — решение, принятое прямо в момент разговора, и предсказание по опыту: I'll help you, it will probably be warm. " +
      "going to — план, который был готов до разговора, и вывод из того, что видно сейчас: We're going to sell the car, " +
      "look at those clouds — it's going to rain. Present Continuous — договорённость с конкретным временем: I'm meeting Anna at 6. " +
      "Коротко: will — решил сейчас, going to — уже решил, Present Continuous — уже договорился.",
    examples: [
      "I'll help you with the bags — решил прямо сейчас, увидев их.",
      "We're going to sell the car — план был раньше, просто сообщаем.",
      "The car is making a strange noise — it's going to break down — вывод из того, что видно сейчас.",
      "I'm having lunch with Olga tomorrow — договорённость с временем.",
      "It will probably be warm tomorrow — предсказание, а не план.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The phone is ringing in the other room. Don't worry, I ___ answer it.",
        options: ["will", "am going to", "am answering"],
        answer: "will",
        why: "Решение прозвучало только сейчас, в ответ на звонок — will.",
      },
      {
        kind: "choice",
        prompt: "We ___ visit our parents this weekend — I've already booked the tickets.",
        options: ["are going to", "will", "are visit"],
        answer: "are going to",
        why: "Билеты куплены заранее, значит это план, а не решение сейчас: going to.",
      },
      {
        kind: "gap",
        prompt: "Look at those clouds! It ___ (rain).",
        answer: "is going to rain",
        why: "Вывод сделан по тому, что видно сейчас, — going to, а не will.",
      },
      {
        kind: "choice",
        prompt: "I ___ Anna at 6 — we agreed on it yesterday.",
        options: ["am meeting", "will meet", "meet"],
        answer: "am meeting",
        why: "Договорённость с конкретным временем — Present Continuous для будущего.",
      },
      {
        kind: "gap",
        prompt: "I think our team ___ (win) the match.",
        answer: "will win",
        why: "Это мнение-предсказание, а не план — will + глагол.",
      },
      {
        kind: "gap",
        prompt: "I can't come at 5 — I ___ (see) the doctor then.",
        answer: "am seeing",
        why: "Запись к врачу на конкретное время — договорённость, Present Continuous.",
      },
      {
        kind: "gap",
        prompt: "I ___ (not / tell) anyone, I promise.",
        answer: "won't tell",
        why: "Обещание даётся сейчас: will, в отрицании — won't + глагол.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мы собираемся переехать в марте».",
        options: ["We", "are", "going", "to", "move", "in", "March"],
        answer: "We are going to move in March",
        why: "Переезд — обдуманный план на будущее: are going to + глагол.",
      },
    ],
  },
];
