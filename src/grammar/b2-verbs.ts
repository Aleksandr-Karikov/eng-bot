import type { TopicDraft } from "./types";

/**
 * Темы уровня B2 — глагольные конструкции: герундий и инфинитив, фразовые глаголы, третий тип условия.
 *
 * Здесь важно не столько узнать форму, сколько увидеть, что выбор формы меняет смысл: stop doing и
 * stop to do — разные поступки, turn the light on и turn it on — один и тот же, а if + had + V3 говорит
 * не о будущем, а о том, чего уже не исправить. Поэтому `why` объясняет выбор, а не пересказывает правило.
 *
 * Контент ручной: ответ проверяется сравнением строк, поэтому ошибка в контенте означает
 * «человек ответил верно, а бот сказал неверно». Проверка — `scripts/build-grammar.ts --dry-run`.
 */
export const B2_VERBS: TopicDraft[] = [
  {
    slug: "gerund-infinitive",
    category: "формы глаголов",
    title: "Gerund или инфинитив: enjoy doing, want to do",
    level: "B2",
    rule:
      "После одних глаголов нужна форма -ing, после других — to + инфинитив, и это свойство самого глагола: " +
      "enjoy doing, mind waiting, suggest going, но want to do, decide to do, manage to do. Часть глаголов " +
      "меняет смысл от формы: stop doing — бросить действие (he stopped smoking), stop to do — остановиться, " +
      "чтобы что-то сделать (he stopped to buy bread); remember/forget doing — помнить или забыть, как делал, " +
      "remember/forget to do — не забыть или забыть сделать. После предлогов всегда -ing, поэтому look forward to " +
      "doing — это предлог to, а не частица инфинитива. В устойчивых оборотах форма закреплена: can't help doing, " +
      "it's no use doing.",
    examples: [
      "I enjoy reading before bed — после enjoy возможен только -ing, to read здесь невозможно.",
      "She decided to change jobs after the merger — decide требует to + инфинитив.",
      "He stopped smoking two years ago — бросил привычку, поэтому -ing.",
      "On the way home I stopped to buy bread — остановился ради цели, поэтому to + инфинитив.",
      "I'm looking forward to hearing from you — to здесь предлог, после предлога всегда -ing.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I don't mind ___ overtime this week, but I'd like to know in advance.",
        options: ["working", "to work", "work"],
        answer: "working",
        why: "Mind берёт только -ing: это не цель и не намерение, а отношение к самому действию.",
      },
      {
        kind: "choice",
        prompt: "We stopped ___ petrol on the way to the airport.",
        options: ["to get", "getting", "get"],
        answer: "to get",
        why: "Остановились, чтобы заправиться, — это цель остановки; getting означало бы «перестали заправляться».",
      },
      {
        kind: "gap",
        prompt: "After the meeting I want ___ (discuss) the budget with you.",
        answer: "to discuss",
        why: "Want выражает намерение, а намерение идёт через to + инфинитив, а не через -ing.",
      },
      {
        kind: "gap",
        prompt: "She suggested ___ (take) a taxi instead of the bus.",
        answer: "taking",
        why: "Suggest не берёт to-инфинитив вообще: после него нужна форма -ing, иначе получается калька с русского.",
      },
      {
        kind: "choice",
        prompt: "I'll never forget ___ my first salary — I bought a bicycle for my brother.",
        options: ["spending", "to spend", "spend"],
        answer: "spending",
        why: "Это воспоминание о том, как тратил, поэтому forget doing; forget to do значило бы «забыл потратить».",
      },
      {
        kind: "gap",
        prompt: "Please remember ___ (lock) the office before you leave.",
        answer: "to lock",
        why: "Здесь просьба про будущее действие: remember to do — не забыть сделать, а не вспоминать, как делал.",
      },
      {
        kind: "gap",
        prompt: "I'm looking forward to ___ (hear) from you.",
        answer: "hearing",
        why: "В look forward to слово to — предлог, а после предлога ставится -ing, а не инфинитив.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я люблю готовить по выходным».",
        options: ["I", "enjoy", "cooking", "at", "the", "weekends"],
        answer: "I enjoy cooking at the weekends",
        why: "Enjoy — из тех глаголов, которые не принимают to: только cooking, иначе фраза сразу звучит по-иностранному.",
      },
    ],
  },
  {
    slug: "phrasal-verbs",
    category: "выбор слова",
    title: "Фразовые глаголы: look after, turn it on",
    level: "B2",
    rule:
      "Фразовый глагол — это глагол плюс частица, и смысл почти не выводится из частей: look after — заботиться, " +
      "look for — искать, look up — смотреть в словаре, give up — бросить, put off — перенести на потом. " +
      "Многие из них разделяемые: местоимение обязательно встаёт между глаголом и частицей — turn it on, put it off, " +
      "give it up, а не turn on it. С существительным допустимы оба порядка (turn on the light / turn the light on), " +
      "но с местоимением — только один. Часть глаголов не разделяется вовсе: look after the kids, но не look the kids after.",
    examples: [
      "Could you look after my cat while I'm away? — look after значит «заботиться» и не разделяется.",
      "I've been looking for my keys all morning — look for это «искать», а не «смотреть за».",
      "Look the word up if you're not sure — с существительным частица может стоять и в конце.",
      "Turn it on, please — с местоимением частица идёт только после него: on it сказать нельзя.",
      "He gave up smoking last year — give up это «бросить», частица полностью меняет смысл.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "Could you ___ the light? It's getting dark in here.",
        options: ["turn on", "turn off", "turn up"],
        answer: "turn on",
        why: "Стало темно, значит лампу включают; turn off выключил бы её, а turn up только прибавил бы яркость.",
      },
      {
        kind: "choice",
        prompt: "I need to ___ this word in the dictionary.",
        options: ["look after", "look for", "look up"],
        answer: "look up",
        why: "В словаре слово именно смотрят — look up; look for относится к потерянным вещам, а не к информации.",
      },
      {
        kind: "gap",
        prompt: "Our flight was ___ until midnight because of the storm. (перенести на более позднее время)",
        answer: "put off",
        why: "Рейс не отменили, а сдвинули по времени — это put off, а не give up и не turn off.",
      },
      {
        kind: "choice",
        prompt: "Those boots are too small — I'm going to ___.",
        options: ["take them back", "take back them", "back take them"],
        answer: "take them back",
        why: "С местоимением частица стоит после него: them вставляется внутрь, иначе фраза невозможна.",
      },
      {
        kind: "gap",
        prompt: "Who will ___ the dog while we're on holiday? (заботиться)",
        answer: "look after",
        why: "Look after не разделяется: заботиться — значит держать after сразу за глаголом, даже с длинным дополнением.",
      },
      {
        kind: "choice",
        prompt: "We've ___ sugar — could you pick some up on your way home?",
        options: ["run out of", "given up", "put off"],
        answer: "run out of",
        why: "Сахар кончился, а не был брошен и не перенесён: run out of как раз про запас, которого больше нет.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я не могу это отложить».",
        options: ["I", "can't", "put", "it", "off"],
        answer: "I can't put it off",
        why: "Местоимение it не пропускает частицу за собой: put it off, и никак не put off it.",
      },
      {
        kind: "choice",
        prompt: "Don't ___ — the answer is at the bottom of the page.",
        options: ["give up", "look up", "turn up"],
        answer: "give up",
        why: "Речь о том, чтобы не сдаваться; look up здесь означало бы «посмотреть в словаре», а turn up — «прийти».",
      },
    ],
  },
  {
    slug: "conditionals-third",
    category: "времена",
    title: "Third Conditional и mixed: сожаления о прошлом",
    level: "B2",
    rule:
      "Third Conditional говорит о прошлом, которое уже не изменить: if + had + V3 в условии, would have + V3 " +
      "в следствии — If I had left earlier, I would have caught the train. Смысл всегда один: этого не было, " +
      "и мы жалеем или объясняем. Mixed Conditional смешивает времена, когда прошлое тянется в настоящее: " +
      "If I had studied medicine, I would be a doctor now — в следствии уже нет have. Бывает и обратное смешение, " +
      "когда постоянное свойство объясняет прошлый поступок: If he weren't so stubborn, he would have accepted the offer. " +
      "Вместо would have можно поставить could have или might have, если речь не о результате, а о возможности.",
    examples: [
      "If I had left home ten minutes earlier, I would have caught the 8:15 — я не вышел раньше, и поезд ушёл без меня.",
      "I would have called you if I had known you were in town — звонка не было, потому что я не знал.",
      "If I had taken that job in Berlin, I would be living abroad now — прошлое решение определяет настоящее.",
      "If she weren't so shy, she would have spoken at the conference — характер в настоящем объясняет провал в прошлом.",
      "If we had booked earlier, we could have got a cheaper flight — речь о возможности, поэтому could have.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "If I ___ about the strike, I would have taken the metro.",
        options: ["had known", "knew", "have known"],
        answer: "had known",
        why: "И метро не было, и знания не было — обе части про несбывшееся прошлое, поэтому в условии Past Perfect.",
      },
      {
        kind: "gap",
        prompt: "If she ___ (leave) earlier, she wouldn't have missed the flight.",
        answer: "had left",
        why: "Сожаление о прошлом: в условии had + V3, даже если по-русски хочется сказать просто «вышла бы».",
      },
      {
        kind: "choice",
        prompt: "We would have finished the project on time if the client ___ the brief.",
        options: ["hadn't changed", "didn't change", "hasn't changed"],
        answer: "hadn't changed",
        why: "Бриф изменили в прошлом, и именно это сорвало срок — значит в условии Past Perfect, а не Past Simple.",
      },
      {
        kind: "gap",
        prompt: "I ___ (not / call) him if I had known he was on holiday.",
        answer: "wouldn't have called",
        why: "Следствие нереального прошлого строится через would (not) have + V3; одного wouldn't мало.",
      },
      {
        kind: "choice",
        prompt: "If I had studied medicine, I ___ a doctor now.",
        options: ["would be", "would have been", "will be"],
        answer: "would be",
        why: "Now в конце переносит следствие в настоящее, поэтому have исчезает — это mixed, а не чистый третий тип.",
      },
      {
        kind: "choice",
        prompt: "If he weren't so stubborn, he ___ our offer last week.",
        options: ["would have accepted", "would accept", "accepted"],
        answer: "would have accepted",
        why: "Характер в настоящем (weren't) объясняет поступок в прошлом, а следствие всё равно про прошлое — would have.",
      },
      {
        kind: "gap",
        prompt: "If we had booked the tickets in advance, we ___ (can / get) much cheaper seats.",
        answer: "could have got",
        why: "Здесь важна не упущенная поездка, а упущенная возможность, поэтому модальный глагол + have + V3.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он бы не опоздал, если бы вышел раньше».",
        options: ["He", "wouldn't", "have", "been", "late", "if", "he", "had", "left", "earlier"],
        answer: "He wouldn't have been late if he had left earlier",
        why: "Следствие идёт первым, но форма та же: wouldn't have + V3 и had + V3 в условии.",
      },
    ],
  },
];
