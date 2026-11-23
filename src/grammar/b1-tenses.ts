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
      {
        kind: "gap",
        prompt: "I ___ (not / eat) anything since breakfast.",
        answer: "haven't eaten",
        why: "Since breakfast открывает период, который тянется до сейчас: с I идёт haven't, а V3 от eat — eaten, не ate.",
      },
      {
        kind: "gap",
        prompt: "How long ___ (you / know) your best friend?",
        answer: "have you known",
        why: "How long спрашивает про период до настоящего момента, поэтому вопрос строится have + you + known, а не did you know.",
      },
      {
        kind: "gap",
        prompt: "This is the first time I ___ (drive) a car like this.",
        answer: "have driven",
        why: "First time значит «до этого момента такого опыта не было», поэтому нужен V3 driven, а не drove.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мы не видели её с прошлой пятницы».",
        options: ["We", "her", "haven't", "since", "seen", "last", "Friday"],
        answer: "We haven't seen her since last Friday",
        why: "Since last Friday задаёт точку начала, после которой встреч не было: haven't seen, а не didn't see.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Ты когда-нибудь работал в такой большой команде?»",
        options: ["you", "Have", "worked", "ever", "in", "a", "such", "big", "team"],
        answer: "Have you ever worked in such a big team",
        why: "Ever в вопросе спрашивает про опыт за всю жизнь, поэтому Have you + V3, а не Did you work.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он ещё не прочитал моё сообщение».",
        options: ["He", "read", "yet", "hasn't", "my", "message"],
        answer: "He hasn't read my message yet",
        why: "Yet в конце требует Present Perfect: hasn't read, где read — та же форма V3, что и инфинитив.",
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
      {
        kind: "choice",
        prompt: "When ___ you buy that jacket?",
        options: ["did", "have", "were"],
        answer: "did",
        why: "When прямо спрашивает про момент в прошлом, а с таким вопросом идёт did, не have.",
      },
      {
        kind: "gap",
        prompt: "I ___ (never / be) to that restaurant, but my sister said it's good.",
        answer: "have never been",
        why: "Опыт за всю жизнь без даты — have never been; сестра хвалила в прошлом, а мой опыт тянется до сейчас.",
      },
      {
        kind: "gap",
        prompt: "They ___ (get) married in 2018.",
        answer: "got",
        why: "Год назван, событие закреплено за точкой в прошлом — Past Simple got, хотя они женаты до сих пор.",
      },
      {
        kind: "gap",
        prompt: "He ___ (not / call) me since Monday.",
        answer: "hasn't called",
        why: "Since Monday — незакрытый период до настоящего, поэтому hasn't called, а не didn't call.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мы закончили проект на прошлой неделе».",
        options: ["We", "the", "last", "finished", "week", "project"],
        answer: "We finished the project last week",
        why: "Last week — названное время, поэтому finished; have finished прозвучало бы про результат без даты.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Сколько раз ты был в Лондоне?»",
        options: ["How", "have", "many", "you", "times", "been", "London", "to"],
        answer: "How many times have you been to London",
        why: "Считаем случаи за всю жизнь, дата не нужна — have been; про конкретную поездку спросили бы Were you.",
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
      {
        kind: "gap",
        prompt: "It ___ (snow) heavily when we left the house.",
        answer: "was snowing",
        why: "Снег был фоном в момент выхода из дома: процесс, а не отдельное событие, — was snowing.",
      },
      {
        kind: "gap",
        prompt: "Why ___ (he / shout) at the manager yesterday morning?",
        answer: "was he shouting",
        why: "Вопрос про процесс в конкретный отрезок прошлого строится was + he + -ing, а не did he shout.",
      },
      {
        kind: "gap",
        prompt: "I ___ (not / sleep) at 3 a.m. — I was finishing the report.",
        answer: "wasn't sleeping",
        why: "Ночью шёл другой процесс, поэтому отрицание процесса: wasn't sleeping, а не didn't sleep.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Они играли в теннис, когда начался дождь».",
        options: ["They", "were", "playing", "tennis", "rain", "started", "when", "the"],
        answer: "They were playing tennis when the rain started",
        why: "Теннис был длинным фоном — were playing, а дождь коротким событием после when — started.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Что ты делал вчера в это время?»",
        options: ["What", "you", "were", "doing", "time", "this", "yesterday", "at"],
        answer: "What were you doing at this time yesterday",
        why: "Вопрос про процесс вокруг конкретного момента прошлого: were you doing, порядок What + were + you + V-ing.",
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
      {
        kind: "gap",
        prompt: "Wait, I ___ (carry) that box for you — it looks heavy.",
        answer: "will carry",
        why: "Помощь предложена в ту же секунду, поэтому will, а не are going to carry: плана не было.",
      },
      {
        kind: "gap",
        prompt: "Don't call me at 7 — I ___ (have) dinner with the team then.",
        answer: "am having",
        why: "Ужин с командой уже договорён на 7, поэтому Present Continuous для будущего: am having.",
      },
      {
        kind: "gap",
        prompt: "I don't think she ___ (pass) the exam tomorrow.",
        answer: "will pass",
        why: "После I don't think это предсказание, а не план: will pass, потому что отрицается не глагол, а мнение.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я собираюсь начать бегать по утрам».",
        options: ["I", "am", "going", "to", "start", "running", "mornings", "in", "the"],
        answer: "I am going to start running in the mornings",
        why: "Решение принято до разговора, поэтому am going to + start, а не will start.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мы ужинаем с Анной в пятницу».",
        options: ["We", "are", "having", "dinner", "Anna", "with", "on", "Friday"],
        answer: "We are having dinner with Anna on Friday",
        why: "Есть договорённость и день, поэтому Present Continuous are having, а не план going to.",
      },
    ],
  },
];
