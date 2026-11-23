import type { TopicDraft } from "./types";

/**
 * Темы уровня B2: пассив, косвенная речь, относительные придаточные.
 *
 * Здесь объясняем не только форму, но и КОГДА конструкция нужна: пассив в новостях, сдвиг времён
 * в отчётах, defining/non-defining в письмах. Контент ручной — проверяется `scripts/build-grammar.ts --dry-run`.
 */
export const B2_PASSIVE: TopicDraft[] = [
  {
    slug: "passive-voice",
    category: "формы глаголов",
    title: "Passive Voice: действие важнее исполнителя",
    level: "B2",
    rule:
      "Пассив нужен, когда действие важнее исполнителя: The bridge was built in 1890 — кто именно строил, " +
      "неважно или неизвестно. Формула: be в нужном времени + V3 (was built, has been signed, will be sent). " +
      "Исполнителя добавляем через by, только если он действительно важен: The novel was written by Orwell. " +
      "В новостях, отчётах и документах пассив встречается гораздо чаще, чем в разговоре, потому что там важен " +
      "факт, а не тот, кто его сделал: Three people were injured, the invoice has been paid. " +
      "У непереходных глаголов пассива нет: the accident happened, а не was happened.",
    examples: [
      "The bridge was built in 1890 — неважно, кто строил.",
      "Three people were injured in the accident — так пишут в новостях: важен факт, а не виновник.",
      "The invoice has been paid, so we can ship the order — в переписке с клиентом неважно, кто платил.",
      "The novel was written by Orwell — исполнитель важен, поэтому добавляем by.",
      "The new office will be opened next month — планы в документах звучат нейтральнее в пассиве.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The new policy ___ by the board last week.",
        options: ["was approved", "approved", "has approved"],
        answer: "was approved",
        why: "Политику не «одобрила» сама себя: действие направлено на неё, поэтому be + V3 в прошедшем времени.",
      },
      {
        kind: "gap",
        prompt: "This bridge ___ (build) in 1890, and it is still in use.",
        answer: "was built",
        why: "Дата в прошлом и исполнитель неважен — пассив Past Simple: was built.",
      },
      {
        kind: "choice",
        prompt: "Three people ___ in the accident on the motorway, the police report says.",
        options: ["were injured", "injured", "have injured"],
        answer: "were injured",
        why: "В новостях сообщают о пострадавших, а не о том, кто их травмировал, — пассив во множественном числе.",
      },
      {
        kind: "gap",
        prompt: "The contract ___ (already / sign), so we can't change the terms now.",
        answer: "has already been signed",
        why: "Результат важен сейчас, а не момент в прошлом, — Present Perfect Passive: has already been signed.",
      },
      {
        kind: "choice",
        prompt: "The film was directed ___ a young Spanish director.",
        options: ["by", "from", "with"],
        answer: "by",
        why: "Исполнителя в пассиве вводят только предлогом by.",
      },
      {
        kind: "choice",
        prompt: "The accident ___ at about six in the morning.",
        options: ["happened", "was happened", "has been happened"],
        answer: "happened",
        why: "Happen — непереходный глагол, у него нет пассива: событие происходит само.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Отчёт был отправлен вчера».",
        options: ["The", "report", "was", "sent", "yesterday"],
        answer: "The report was sent yesterday",
        why: "Пассив Past Simple: подлежащее + was + V3, время ставим в конец.",
      },
      {
        kind: "gap",
        prompt: "The results ___ (publish) on the website next Monday.",
        answer: "will be published",
        why: "Речь о плане на будущее, а тот, кто публикует, неважен — Future Simple Passive: will be published.",
      },
      {
        kind: "gap",
        prompt: "While the road ___ (repair), we had to use a long detour.",
        answer: "was being repaired",
        why: "Ремонт шёл в тот момент, когда мы объезжали, — процесс в прошлом, поэтому Past Continuous Passive: was being repaired.",
      },
      {
        kind: "gap",
        prompt: "By the time the guests arrived, all the windows ___ (clean).",
        answer: "had been cleaned",
        why: "Окна вымыли ДО прихода гостей, а не в тот же момент — Past Perfect Passive, чтобы показать порядок двух прошедших действий.",
      },
      {
        kind: "gap",
        prompt: "Every year thousands of cars ___ (produce) in this factory.",
        answer: "are produced",
        why: "Действие повторяется каждый год, исполнитель не назван — Present Simple Passive во множественном числе: are produced.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Дом был спроектирован моим дедушкой в 1965 году».",
        options: ["The", "my", "designed", "1965", "house", "grandfather", "by", "was", "in"],
        answer: "The house was designed by my grandfather in 1965",
        why: "Исполнитель здесь важен, поэтому вводим его через by, а обстоятельство времени ставим после него.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Эти документы нужно подписать сегодня».",
        options: ["These", "today", "be", "documents", "signed", "must"],
        answer: "These documents must be signed today",
        why: "После модального время берёт на себя модальный, а глагол идёт как be + V3: must be signed, не must was signed.",
      },
    ],
  },
  {
    slug: "reported-speech",
    category: "времена",
    title: "Косвенная речь: как передать чужие слова",
    level: "B2",
    rule:
      "В косвенной речи после said/told время обычно сдвигается на шаг назад: «I'm busy» → he said he was busy, " +
      "«I finished» → he said he had finished. Say не требует адресата (he said that...), tell требует его " +
      "сразу после себя: he told me that... Вопрос в косвенной речи теряет вспомогательный do и обратный порядок " +
      "слов: he asked me where I lived, he asked if I had sent the invoice. Слова места и времени тоже сдвигаются: " +
      "today → that day, tomorrow → the following day. Но если факт до сих пор верен, сдвиг необязателен: " +
      "she said she lives in Moscow — и она действительно там живёт.",
    examples: [
      "She said she was busy — «I'm busy» превращается в was.",
      "He told me he had already sent the file — Past Simple сдвигается в Past Perfect.",
      "He asked me where I lived — вопрос в косвенной речи идёт прямым порядком слов, без do.",
      "She said she lives in Moscow — факт до сих пор верен, поэтому время можно не сдвигать.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "She said she ___ really tired after the flight.",
        options: ["is", "was", "has been"],
        answer: "was",
        why: "После said время сдвигается на шаг назад: is → was.",
      },
      {
        kind: "gap",
        prompt: "He told me he ___ (finish) the report the day before.",
        answer: "had finished",
        why: "«I finished» в косвенной речи становится Past Perfect, тем более что действие было раньше разговора.",
      },
      {
        kind: "choice",
        prompt: "He ___ me that the meeting had been cancelled.",
        options: ["said", "told", "spoke"],
        answer: "told",
        why: "Перед адресатом (me) нужен tell: told me that.",
      },
      {
        kind: "gap",
        prompt: "She asked me where I ___ (live).",
        answer: "lived",
        why: "Вопрос в косвенной речи — прямой порядок слов и то же смещение времени: lived.",
      },
      {
        kind: "choice",
        prompt: "He asked me ___ I had sent the invoice yet.",
        options: ["if", "that", "what"],
        answer: "if",
        why: "Общий вопрос (да/нет) передаётся через if, вопросительное слово здесь не нужно.",
      },
      {
        kind: "gap",
        prompt: "They said they ___ (move) to Berlin the following month.",
        answer: "would move",
        why: "«We will move» сдвигается в will → would, будущее в прошлом.",
      },
      {
        kind: "choice",
        prompt: "She said she ___ in Moscow — and she still does.",
        options: ["lives", "lived", "had lived"],
        answer: "lives",
        why: "Факт остаётся правдой, поэтому время можно не сдвигать.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она сказала мне, что уже отправила это».",
        options: ["She", "told", "me", "she", "had", "already", "sent", "it"],
        answer: "She told me she had already sent it",
        why: "Tell с адресатом me, а отправка была раньше разговора — Past Perfect.",
      },
      {
        kind: "gap",
        prompt: "She said she ___ (work) late that evening, so she missed the call.",
        answer: "was working",
        why: "«I'm working late» — Present Continuous, а после said он сдвигается на шаг назад в Past Continuous: was working.",
      },
      {
        kind: "gap",
        prompt: "He asked me ___ (not / be) late again.",
        answer: "not to be",
        why: "Просьба в косвенной речи идёт через to + инфинитив, а отрицание ставится перед to: not to be, а не don't be.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он спросил, приду ли я на вечеринку».",
        options: ["He", "come", "I", "party", "asked", "to", "would", "if", "the"],
        answer: "He asked if I would come to the party",
        why: "Общий вопрос передаётся через if, а will сдвигается в would — и никакого вспомогательного do.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она сказала, что тогда была в Лондоне».",
        options: ["She", "London", "was", "said", "then", "in", "she"],
        answer: "She said she was in London then",
        why: "Now в косвенной речи превращается в then, а is — в was: обе перестановки происходят одновременно.",
      },
      {
        kind: "choice",
        prompt: "«I'll see you tomorrow», she said. — She said she would see me ___.",
        options: ["the following day", "tomorrow", "yesterday"],
        answer: "the following day",
        why: "Tomorrow из прямой речи сдвигается в the following day: tomorrow означало бы день после сегодняшнего разговора, а не после того.",
      },
    ],
  },
  {
    slug: "relative-clauses",
    category: "порядок слов",
    title: "Relative clauses: who, which, that, whose",
    level: "B2",
    rule:
      "Who — про людей, which — про вещи, that — универсальное для defining-придаточных, whose — «чей». " +
      "Defining-придаточное (без запятых) уточняет, о ком именно речь, и выбросить его нельзя: the colleague " +
      "who called you. Non-defining (с запятыми) — всего лишь дополнительная информация, и that в нём " +
      "не ставится: my manager, who has worked here for ten years, is leaving. В defining-придаточном " +
      "who/which/that можно опустить, если местоимение не подлежащее: the report (that) I sent — но нельзя, " +
      "если сразу за ним идёт глагол: the colleague who called you.",
    examples: [
      "The colleague who called you is our new designer — who для человека, defining без запятых.",
      "The documents which are on your desk need signing — which для вещей.",
      "My manager, who has worked here for ten years, is leaving — запятые: это уточнение, и that тут нельзя.",
      "That's the client whose contract we signed last week — whose вместо his/her.",
      "The report I sent you was wrong — местоимение опущено, потому что дальше идёт подлежащее I.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The colleague ___ called you this morning is our new designer.",
        options: ["who", "which", "whose"],
        answer: "who",
        why: "Colleague — человек, и в defining-придаточном нужен who (или that).",
      },
      {
        kind: "gap",
        prompt: "That's the client ___ contract we signed last week.",
        answer: "whose",
        why: "Речь о принадлежности («его контракт») — для этого есть только whose.",
      },
      {
        kind: "choice",
        prompt: "My manager, ___ has worked here for ten years, is leaving.",
        options: ["who", "that", "which"],
        answer: "who",
        why: "Придаточное выделено запятыми, а that в non-defining не ставится — остаётся who.",
      },
      {
        kind: "choice",
        prompt: "The documents ___ are on your desk need signing by Friday.",
        options: ["which", "who", "whose"],
        answer: "which",
        why: "Documents — неодушевлённое, значит which.",
      },
      {
        kind: "choice",
        prompt: "The article ___ you sent me was really useful. (местоимение можно опустить)",
        options: ["that", "— (можно опустить)", "whose"],
        answer: "— (можно опустить)",
        why: "В defining-придаточном местоимение-дополнение (you sent it) можно убрать: the article you sent me.",
      },
      {
        kind: "gap",
        prompt: "Our CEO, ___ started the company in 2010, is retiring next month.",
        answer: "who",
        why: "CEO — человек, а запятые делают придаточное non-defining, где that запрещён.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Инженер, который починил наш сервер, в отпуске».",
        options: ["The", "engineer", "who", "fixed", "our", "server", "is", "on", "holiday"],
        answer: "The engineer who fixed our server is on holiday",
        why: "Who — подлежащее придаточного, поэтому опустить его нельзя, а сама главная часть идёт после него.",
      },
      {
        kind: "gap",
        prompt: "We stayed in a small hotel ___ (относительное местоимение) is run by a family from the village.",
        answer: "which",
        why: "Гостиница — предмет, а в defining-придаточном сразу после местоимения идёт глагол is, значит нужен which (или that), но не where.",
      },
      {
        kind: "gap",
        prompt: "That's the town ___ (относительное местоимение) my parents were born.",
        answer: "where",
        why: "Здесь нет подлежащего или дополнения для who/which: придаточное называет место, поэтому where.",
      },
      {
        kind: "gap",
        prompt: "Nobody knows the reason ___ (союзное слово) she left the company so suddenly.",
        answer: "why",
        why: "Причина (reason) вводится словом why: the reason why she left — without него связь теряется.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Учёный, чья статья получила премию, работает в Праге».",
        options: ["The", "the", "article", "in", "scientist", "prize", "won", "Prague", "whose", "works"],
        answer: "The scientist whose article won the prize works in Prague",
        why: "Принадлежность («его статья») передаёт только whose, а works — уже глагол главной части.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мой брат, который живёт в Токио, приезжает на следующей неделе».",
        options: ["My", "Tokyo,", "lives", "next", "brother,", "is", "in", "week", "who", "coming"],
        answer: "My brother, who lives in Tokyo, is coming next week",
        why: "Запятые делают придаточное non-defining — здесь возможен только who, а не that.",
      },
      {
        kind: "choice",
        prompt: "This is the café ___ we first met.",
        options: ["where", "which", "that", "whose"],
        answer: "where",
        why: "Which/that потребовали бы дополнения (which we met — не по-английски): придаточное называет место встречи, значит where.",
      },
    ],
  },
];
