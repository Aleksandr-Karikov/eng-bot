import type { TopicDraft } from "./types";

/**
 * Синтаксис уровня B1: предлоги места, артикли в сложных случаях, порядок слов в вопросах
 * и место наречий.
 *
 * Контент ручной по той же причине, что и в A1/A2: ответ проверяется сравнением строк, поэтому
 * ошибка в контенте выглядит как «человек ответил верно, а бот сказал неверно».
 */
export const B1_SYNTAX: TopicDraft[] = [
  {
    slug: "prepositions-place",
    category: "предлоги",
    title: "In / on / at: где что находится",
    level: "B1",
    rule:
      "in — внутри объёма или замкнутого пространства: in the box, in the office, in Moscow. " +
      "on — на поверхности или на «уровне»: on the table, on the wall, on the third floor. " +
      "at — точка, а не место: at the door, at the bus stop, at work. " +
      "Разница видна на одном предмете: in the box — внутри коробки, on the box — на крышке, at the box — стоим рядом с ней.",
    examples: [
      "The contract is in the drawer — бумага внутри закрытого ящика.",
      "Your coffee is on the desk — на поверхности стола.",
      "I'll wait for you at the entrance — вход как точка встречи, а не помещение.",
      "The office is on the fifth floor — этаж ведёт себя как поверхность, не как объём.",
      "The café is between the bank and the pharmacy — по одному объекту с каждой стороны.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The signed contracts are ___ the top drawer of my desk.",
        options: ["in", "on", "at"],
        answer: "in",
        why: "Ящик — закрытое пространство, бумаги лежат внутри него, а не на поверхности.",
      },
      {
        kind: "choice",
        prompt: "I'll wait for you ___ the bus stop on the corner.",
        options: ["in", "on", "at"],
        answer: "at",
        why: "Остановка — точка на карте и место встречи, а не объём и не поверхность.",
      },
      {
        kind: "gap",
        prompt: "Hang the new calendar ___ the wall above my desk. (предлог поверхности)",
        answer: "on",
        why: "Календарь висит на плоскости стены — это поверхность, значит on, а не in.",
      },
      {
        kind: "choice",
        prompt: "Our team sits ___ the fifth floor, next to the canteen.",
        options: ["in", "on", "at"],
        answer: "on",
        why: "Этаж — это уровень, а не помещение внутри: on the fifth floor.",
      },
      {
        kind: "choice",
        prompt: "There's a small park ___ the office and the metro station.",
        options: ["between", "opposite", "under"],
        answer: "between",
        why: "Названы два объекта по сторонам от парка — это between; opposite значило бы «напротив одного из них».",
      },
      {
        kind: "gap",
        prompt: "The cat is asleep ___ the kitchen table. (внизу, под столом)",
        answer: "under",
        why: "Предмет ниже другого и накрыт им сверху — under, а не below: under подразумевает «прямо под».",
      },
      {
        kind: "choice",
        prompt: "The hotel is ___ the station — just cross the road and you're there.",
        options: ["opposite", "between", "under"],
        answer: "opposite",
        why: "Здания стоят друг напротив друга через дорогу — opposite, а between требует двух объектов.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Ключи на кухонном столе».",
        options: ["The", "keys", "are", "on", "the", "kitchen", "table"],
        answer: "The keys are on the kitchen table",
        why: "Ключи лежат на поверхности стола, поэтому on; между предлогом и существительным может стоять ещё одно определение (kitchen).",
      },
    ],
  },
  {
    slug: "articles-advanced",
    category: "артикли",
    title: "Когда артикль не нужен",
    level: "B1",
    rule:
      "Артикль не ставится, когда речь о неисчисляемом или о множественном вообще, а не о конкретных предметах: I like coffee, Books are expensive. " +
      "Устойчивые сочетания идут без артикля: go to school (учиться), at home, go to bed, have breakfast, by bus. " +
      "Но та же школа со артиклем — уже здание: The plumber is at the school today. Сравните at school («на занятиях») и at the school («в здании»).",
    examples: [
      "I drink coffee every morning — неисчисляемое вообще, не какая-то конкретная чашка.",
      "Cats are more independent than dogs — множественное в общем смысле.",
      "She goes to school by bus — school как учёба, by bus как способ передвижения.",
      "I'm at home, call me later — устойчивое сочетание, the здесь не появляется никогда.",
      "The mechanic is at the school — конкретное здание, где идёт ремонт, поэтому the.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I usually have ___ breakfast at seven and leave at eight.",
        options: ["a", "the", "— (без артикля)"],
        answer: "— (без артикля)",
        why: "Have breakfast — устойчивое сочетание о приёме пищи вообще; артикль превратил бы завтрак в один конкретный.",
      },
      {
        kind: "choice",
        prompt: "My daughter goes to ___ school by bike — she's in the fifth grade.",
        options: ["a", "the", "— (без артикля)"],
        answer: "— (без артикля)",
        why: "Здесь school — это учёба, а не здание, поэтому артикль не нужен: go to school.",
      },
      {
        kind: "choice",
        prompt: "The plumber is at ___ school today, fixing the pipes in the gym.",
        options: ["— (без артикля)", "the", "a"],
        answer: "the",
        why: "Речь о конкретном здании, где работают, — это уже не «учиться», значит the school.",
      },
      {
        kind: "gap",
        prompt: "I really liked ___ books you lent me. (книги конкретные — те самые)",
        answer: "the",
        why: "Множественное число не отменяет артикль: книги конкретные, те самые, поэтому the. Без артикля было бы «книги вообще».",
      },
      {
        kind: "choice",
        prompt: "I don't eat ___ meat — I've been vegetarian for years.",
        options: ["a", "the", "— (без артикля)"],
        answer: "— (без артикля)",
        why: "Meat — неисчисляемое, и речь о мясе вообще, а не о куске на тарелке.",
      },
      {
        kind: "gap",
        prompt: "She plays ___ piano really well. (артикль перед музыкальным инструментом)",
        answer: "the",
        why: "Play + инструмент — устойчивая модель с the: play the piano, play the guitar. С видами спорта наоборот: play football.",
      },
      {
        kind: "choice",
        prompt: "We travelled around Italy ___ train, stopping in small towns.",
        options: ["by", "on", "in"],
        answer: "by",
        why: "Способ передвижения — by + транспорт без артикля: by train, by car. On the train значило бы «в конкретном поезде».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я езжу на работу на автобусе каждое утро».",
        options: ["I", "go", "to", "work", "by", "bus", "every", "morning"],
        answer: "I go to work by bus every morning",
        why: "Work как «работа» вообще идёт без артикля, а by bus — способ передвижения, тоже без the.",
      },
    ],
  },
  {
    slug: "word-order-questions",
    category: "порядок слов",
    title: "Порядок слов в вопросах",
    level: "B1",
    rule:
      "В прямом вопросе после вопросительного слова идёт вспомогательный глагол, и только потом подлежащее: Where did you go? " +
      "В косвенном вопросе порядок прямой, как в утверждении, и do/does/did исчезают: Do you know where he is? " +
      "Предлог в разговорном вопросе остаётся в конце: Who are you waiting for? — переносить его вперёд (For whom are you waiting?) в обычной речи не нужно.",
    examples: [
      "Where did you put the keys? — вопросительное слово + did + подлежащее.",
      "Do you know where he works? — косвенный вопрос: where he works, без does.",
      "Could you tell me when the train leaves? — прямой порядок слов, без did.",
      "Who are you waiting for? — предлог остаётся в конце, а не идёт вперёд.",
      "What time does the shop open? — does перед подлежащим, глагол без -s.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "Excuse me, do you know where ___?",
        options: ["is the nearest bank", "the nearest bank is"],
        answer: "the nearest bank is",
        why: "После Do you know идёт косвенный вопрос: порядок как в утверждении, подлежащее перед глаголом.",
      },
      {
        kind: "choice",
        prompt: "Could you tell me when ___?",
        options: ["does the meeting start", "the meeting starts", "the meeting does start"],
        answer: "the meeting starts",
        why: "Tell me вводит косвенный вопрос: вспомогательный does не нужен, -s возвращается к глаголу.",
      },
      {
        kind: "gap",
        prompt: "Who are you waiting ___? (предлог в конце вопроса)",
        answer: "for",
        why: "В разговорном вопросе предлог остаётся после глагола: wait for → waiting for. Формальное For whom... звучит книжно.",
      },
      {
        kind: "choice",
        prompt: "Where ___ you buy that laptop? It looks new.",
        options: ["did", "do", "does"],
        answer: "did",
        why: "Покупка в прошлом, а подлежащее you требует did — и глагол после него идёт в первой форме.",
      },
      {
        kind: "gap",
        prompt: "I don't remember ___ he lives. (вопросительное слово «где»)",
        answer: "where",
        why: "Remember вводит косвенный вопрос: where + he + lives, без does и без перестановки.",
      },
      {
        kind: "choice",
        prompt: "Who ___ you talking to when I called?",
        options: ["were", "did", "was"],
        answer: "were",
        why: "Предлог to остался в конце, а вспомогательный глагол согласуется с you — were, не was и не did.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Куда ты ездил в прошлые выходные?»",
        options: ["Where", "did", "you", "go", "last", "weekend"],
        answer: "Where did you go last weekend",
        why: "Вопросительное слово + did + подлежащее + go: после did глагол теряет прошедшую форму.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Ты знаешь, когда закрывается магазин?»",
        options: ["Do", "you", "know", "when", "the", "shop", "closes"],
        answer: "Do you know when the shop closes",
        why: "Первая часть — прямой вопрос Do you know, вторая — косвенный when the shop closes, поэтому без does.",
      },
    ],
  },
  {
    slug: "adverb-position",
    category: "порядок слов",
    title: "Где стоит наречие: always, well, quickly",
    level: "B1",
    rule:
      "Наречия частотности (always, usually, often, sometimes, never, rarely) стоят перед смысловым глаголом, но после be: She usually works late, He is always late. " +
      "Если есть вспомогательный глагол — наречие встаёт между ним и смысловым: I have never been there, Do you often travel? " +
      "Наречия образа действия (well, quickly, carefully) идут после глагола или его дополнения: He drives carefully, She speaks English well.",
    examples: [
      "I always check my email before the standup — перед смысловым глаголом.",
      "He is usually the first to arrive — после be, а не перед ним.",
      "I have never been to Japan — между have и причастием.",
      "She speaks English really well — образ действия после дополнения English.",
      "He drives carefully, especially in the rain — наречие сразу после глагола.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I ___ drink coffee after six — otherwise I can't sleep.",
        options: ["never", "not never", "don't never"],
        answer: "never",
        why: "Never само по себе отрицательное, поэтому второе отрицание (not, don't) не добавляется никогда.",
      },
      {
        kind: "choice",
        prompt: "He ___ late for meetings — the boss has already noticed.",
        options: ["is usually", "usually is", "usually"],
        answer: "is usually",
        why: "С глаголом be наречие частотности идёт после него, а не перед ним: is usually.",
      },
      {
        kind: "choice",
        prompt: "I ___ to Japan, but it's on my list.",
        options: ["have never been", "never have been", "have been never"],
        answer: "have never been",
        why: "Наречие частотности встаёт между вспомогательным have и причастием been.",
      },
      {
        kind: "gap",
        prompt: "She speaks Spanish very ___ (good).",
        answer: "well",
        why: "Образ действия описывает глагол speak, значит наречие well; good — прилагательное и определяет существительное.",
      },
      {
        kind: "choice",
        prompt: "Please drive ___ — the roads are icy this morning.",
        options: ["carefully", "careful", "more careful"],
        answer: "carefully",
        why: "Наречие образа действия ставится после глагола drive и объясняет, как именно ехать.",
      },
      {
        kind: "gap",
        prompt: "The train ___ arrives on time — the repairs are still going on. (rarely)",
        answer: "rarely",
        why: "Перед смысловым глаголом arrives — наречие частотности, в том числе rarely и never.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он всегда приходит в офис рано».",
        options: ["He", "always", "arrives", "at", "the", "office", "early"],
        answer: "He always arrives at the office early",
        why: "Always стоит перед смысловым глаголом, а early — наречие образа действия, поэтому в конце.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она всегда опаздывает на утренний созвон».",
        options: ["She", "is", "always", "late", "for", "the", "morning", "call"],
        answer: "She is always late for the morning call",
        why: "После be наречие частотности идёт за ним: is always, а не always is.",
      },
    ],
  },
];
