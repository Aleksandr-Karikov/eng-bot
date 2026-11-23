import type { TopicDraft } from "./types";

/**
 * Темы уровня B1: модальные глаголы и условные предложения. Контент ручной — проверяется скриптом
 * `scripts/build-grammar.ts --dry-run`.
 *
 * Здесь важна не только форма, но и разница по смыслу (must — сам, have to — извне, should — совет):
 * проверка ответа сравнивает строки, поэтому тонкость обязана быть объяснена в `why`, а не подразумеваться.
 */
export const B1_MODALS: TopicDraft[] = [
  {
    slug: "modals-obligation",
    category: "модальные глаголы",
    title: "Must / have to / should: обязанность и совет",
    level: "B1",
    rule:
      "must — необходимость, которую человек чувствует сам: I must call my mum tonight. have to — " +
      "необходимость извне, от правил, начальника или обстоятельств: I have to wear a badge at work. " +
      "should — совет, а не обязанность: You should take a break. Отрицания расходятся по смыслу: " +
      "mustn't — запрещено, don't have to — не обязательно, можно и не делать.",
    examples: [
      "I must finish this tonight — сам решил, это моя внутренняя необходимость.",
      "I have to wear a badge in the office — правило компании, а не мой выбор.",
      "You should ask for a pay rise — совет, а не приказ.",
      "You mustn't park here — запрещено.",
      "You don't have to work on Saturday — не обязательно, но если хочешь, можно.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "My manager says I ___ send the report by Friday.",
        options: ["must", "have to", "should"],
        answer: "have to",
        why: "Срок поставил начальник — необходимость извне, поэтому have to; should был бы просто советом.",
      },
      {
        kind: "choice",
        prompt: "I really ___ finish this today — I promised myself.",
        options: ["must", "have to", "should"],
        answer: "must",
        why: "Обещание самому себе — личная необходимость, must; have to звучало бы как правило извне.",
      },
      {
        kind: "gap",
        prompt: "You look exhausted. You ___ (take) a few days off.",
        answer: "should take",
        why: "Это совет, а не обязанность — should + глагол без to.",
      },
      {
        kind: "choice",
        prompt: "You ___ park here — this is the ambulance entrance.",
        options: ["mustn't", "don't have to", "shouldn't"],
        answer: "mustn't",
        why: "Стоять здесь запрещено — mustn't; don't have to значило бы «не обязательно».",
      },
      {
        kind: "gap",
        prompt: "Tomorrow is a public holiday, so we ___ (not / work).",
        answer: "don't have to",
        why: "Работать не обязательно — don't have to; mustn't здесь значило бы «нельзя».",
      },
      {
        kind: "choice",
        prompt: "I ___ wear a tie at work, but I usually do.",
        options: ["don't have to", "mustn't", "shouldn't"],
        answer: "don't have to",
        why: "Правила дресс-кода нет, это не запрет — «не обязательно» передаёт don't have to.",
      },
      {
        kind: "gap",
        prompt: "Passengers ___ (not / use) phones during take-off.",
        answer: "mustn't",
        why: "Требование авиакомпании — запрет, а не «не обязательно», поэтому mustn't.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Тебе не нужно приходить так рано».",
        options: ["You", "don't", "have", "to", "come", "so", "early"],
        answer: "You don't have to come so early",
        why: "«Не обязательно» — don't have to; с mustn't вышло бы «нельзя приходить так рано».",
      },
      {
        kind: "gap",
        prompt: "How often ___ (have to / you) travel for work?",
        answer: "do you have to",
        why: "Вопрос к you строится через вспомогательный do, а have to не меняется: do you have to travel.",
      },
      {
        kind: "gap",
        prompt: "Last year I ___ (have to) commute two hours each way.",
        answer: "had to",
        why: "У must нет прошедшего времени, поэтому обязанность в прошлом передаёт только had to.",
      },
      {
        kind: "gap",
        prompt: "In my opinion, you ___ (not / should) tell your boss about it yet.",
        answer: "shouldn't",
        why: "Это совет воздержаться, а не запрет — shouldn't. Mustn't прозвучало бы как «тебе запрещено».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она должна носить форму на работе».",
        options: ["She", "has", "to", "wear", "a", "uniform", "at", "work"],
        answer: "She has to wear a uniform at work",
        why: "Правило компании — have to, и в третьем лице единственного числа have превращается в has.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Здесь нельзя курить».",
        options: ["You", "mustn't", "smoke", "here"],
        answer: "You mustn't smoke here",
        why: "Курение запрещено — mustn't; с don't have to вышло бы, что курить просто необязательно.",
      },
    ],
  },
  {
    slug: "modals-ability",
    category: "модальные глаголы",
    title: "Can / could / be able to: умение и разрешение",
    level: "B1",
    rule:
      "can — умение и разрешение в настоящем: I can swim, you can use my laptop. could — умение в прошлом " +
      "(I could read at five) и вежливая просьба (Could you help me?). be able to нужно там, где can " +
      "не поставить: после will, в perfect и после других модальных — I'll be able to come on Monday. " +
      "Разрешение в конкретном случае в прошлом — was/were allowed to, а не could.",
    examples: [
      "I can drive, but I can't park — умение в настоящем.",
      "She could read music at the age of five — умение в прошлом.",
      "Could you send me the file? — вежливая просьба, а не прошедшее время.",
      "I'll be able to help you on Monday — после will только be able to.",
      "We were allowed to leave early yesterday — разрешение в конкретном случае.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I ___ finish the project by Friday, I promise.",
        options: ["will can", "will be able to", "can be able to"],
        answer: "will be able to",
        why: "С will глагол can не ставится — будущее умение передаёт will be able to.",
      },
      {
        kind: "choice",
        prompt: "When I was a child, I ___ climb any tree in the yard.",
        options: ["could", "can", "will be able to"],
        answer: "could",
        why: "Умение в прошлом — could; can здесь был бы про настоящее.",
      },
      {
        kind: "gap",
        prompt: "I ___ (not / can) hear you — the line is terrible.",
        answer: "can't",
        why: "Неспособность сейчас: can + not даёт can't (полная форма cannot).",
      },
      {
        kind: "gap",
        prompt: "Next year I ___ (be able to) work from home twice a week.",
        answer: "will be able to",
        why: "Речь о будущем, а can с will не сочетается — нужен will be able to.",
      },
      {
        kind: "choice",
        prompt: "Guests ___ use the gym for free until 10 p.m.",
        options: ["can", "could", "were allowed to"],
        answer: "can",
        why: "Разрешение в настоящем — can; could и were allowed to увели бы нас в прошлое.",
      },
      {
        kind: "choice",
        prompt: "The manager ___ leave early yesterday because he felt ill.",
        options: ["was allowed to", "could", "can"],
        answer: "was allowed to",
        why: "Разрешение в один конкретный день в прошлом — was allowed to, а не общее «умел» could.",
      },
      {
        kind: "choice",
        prompt: "I ___ sleep last night because of the noise outside.",
        options: ["couldn't", "can't", "don't can"],
        answer: "couldn't",
        why: "Неспособность в прошлом — couldn't; формы don't can в английском нет.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я смогу помочь тебе в понедельник».",
        options: ["I", "will", "be", "able", "to", "help", "you", "on", "Monday"],
        answer: "I will be able to help you on Monday",
        why: "Будущее умение строится через will be able to, can с will не ставится.",
      },
      {
        kind: "gap",
        prompt: "___ (can / you) pass me the salt, please?",
        answer: "Could you",
        why: "Просьба за столом звучит вежливо только через Could you; Can you поняли бы, но вежливость здесь несут could.",
      },
      {
        kind: "gap",
        prompt: "We ___ (not / be able to) come to the wedding next month.",
        answer: "won't be able to",
        why: "Отказ в будущем: отрицание ставится перед be able to, а не перед can — won't be able to.",
      },
      {
        kind: "gap",
        prompt: "Before the accident he ___ (be able to) walk without a stick.",
        answer: "was able to",
        why: "Способность одного конкретного человека в прошлом часто идёт через was able to; could здесь прозвучало бы как общее «умел когда-то».",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Ты умеешь водить?»",
        options: ["Can", "you", "drive"],
        answer: "Can you drive",
        why: "Вопрос об умении строится перестановкой can перед подлежащим — do в этом вопросе не нужен.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Я не смог найти твою книгу».",
        options: ["I", "wasn't", "able", "to", "find", "your", "book"],
        answer: "I wasn't able to find your book",
        why: "Одна конкретная неудавшаяся попытка в прошлом — wasn't able to, а не общее couldn't.",
      },
    ],
  },
  {
    slug: "conditionals-first-second",
    category: "времена",
    title: "First и Second Conditional: реальное и нереальное условие",
    level: "B1",
    rule:
      "First Conditional — реальное, вполне возможное будущее: if + Present Simple, затем will + глагол " +
      "(If it rains, we'll stay in). Second Conditional — нереальное или маловероятное: if + Past Simple, " +
      "затем would + глагол (If I had more time, I would learn Spanish). После if никогда не ставится " +
      "will или would, а в Second Conditional с be используется were: If I were you.",
    examples: [
      "If you finish the report today, we'll send it tomorrow — реальное условие, после if настоящее время.",
      "If I had a bigger flat, I would get a dog — сейчас это невозможно, past + would.",
      "If I were you, I would ask for a raise — совет через were, а не was.",
      "If she doesn't call, I'll email her — отрицание в придаточном через doesn't.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "If it ___ tomorrow, we'll cancel the picnic.",
        options: ["rains", "will rain", "rained"],
        answer: "rains",
        why: "В First Conditional после if идёт Present Simple, will остаётся только в главной части.",
      },
      {
        kind: "gap",
        prompt: "If I ___ (have) more money, I would buy a flat.",
        answer: "had",
        why: "Second Conditional: после if — Past Simple, в главной части would.",
      },
      {
        kind: "choice",
        prompt: "If you study hard, you ___ the exam.",
        options: ["will pass", "would pass", "pass"],
        answer: "will pass",
        why: "Условие реальное — в главной части will + глагол.",
      },
      {
        kind: "gap",
        prompt: "If I ___ (be) you, I would apologise.",
        answer: "were",
        why: "В Second Conditional с be устойчиво берут were, даже с I.",
      },
      {
        kind: "choice",
        prompt: "I would call him if I ___ his number.",
        options: ["had", "have", "will have"],
        answer: "had",
        why: "Would в главной части требует Past Simple после if — had.",
      },
      {
        kind: "gap",
        prompt: "She ___ (not / come) to the party if you don't invite her.",
        answer: "won't come",
        why: "First Conditional с отрицанием в главной части: will not даёт won't come.",
      },
      {
        kind: "choice",
        prompt: "If I ___ the lottery, I would travel around the world.",
        options: ["won", "win", "will win"],
        answer: "won",
        why: "Шанс почти нулевой — Second Conditional: после if Past Simple, дальше would.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если пойдёт дождь, мы останемся дома».",
        options: ["If", "it", "rains", "we", "will", "stay", "at", "home"],
        answer: "If it rains we will stay at home",
        why: "После if настоящее время (rains), will — только в главной части.",
      },
      {
        kind: "gap",
        prompt: "If I ___ (not / be) so tired, I would go to the gym.",
        answer: "weren't",
        why: "Нереальное условие про «сейчас»: после if был бы present, а в Second Conditional — Past Simple, отрицание weren't.",
      },
      {
        kind: "gap",
        prompt: "If you ___ (leave) now, you'll catch the last train.",
        answer: "leave",
        why: "После if настоящее время даже когда речь о будущем — will живёт только в главной части.",
      },
      {
        kind: "gap",
        prompt: "What ___ (you / do) if you lost your passport abroad?",
        answer: "would you do",
        why: "Гипотетический вопрос несёт would перед подлежащим — do после would идёт в первой форме.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если бы у меня было больше времени, я бы учил испанский».",
        options: ["If", "I", "had", "more", "time", "I", "would", "learn", "Spanish"],
        answer: "If I had more time I would learn Spanish",
        why: "Нереальное условие: had после if и would + learn в главной части; will здесь был бы ошибкой.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если ты позвонишь, я тебе помогу».",
        options: ["If", "you", "call", "I", "will", "help", "you"],
        answer: "If you call I will help you",
        why: "После if — настоящее call, а will появляется только в главной части перед help.",
      },
    ],
  },
  {
    slug: "used-to",
    category: "времена",
    title: "Used to / would: прошлые привычки",
    level: "B1",
    rule:
      "used to + глагол — регулярное действие или состояние в прошлом, которого больше нет: I used to smoke, " +
      "but I stopped. would + глагол — только повторяющиеся действия (Every summer we would drive to the sea), " +
      "но не состояния: нельзя would have или would be. Вопрос и отрицание строятся через did + use to: " +
      "Did you use to live here? I didn't use to like coffee.",
    examples: [
      "I used to work nights — привычка в прошлом, сейчас уже нет.",
      "Every summer we would drive to my grandmother's — повторяющееся действие, поэтому можно would.",
      "She used to have long hair — состояние, здесь только used to, would не подходит.",
      "Did you use to live in Kazan? — вопрос через did, и use to без -d.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I ___ like coffee, but now I drink three cups a day.",
        options: ["didn't use to", "didn't used to", "don't use to"],
        answer: "didn't use to",
        why: "После did пишется use to без -d, а время здесь прошедшее.",
      },
      {
        kind: "gap",
        prompt: "There ___ (use / be) a cinema here, but it closed years ago.",
        answer: "used to be",
        why: "Be — состояние, поэтому only used to be; с would состояние не выразить.",
      },
      {
        kind: "choice",
        prompt: "My grandfather ___ have a motorbike when he was young.",
        options: ["used to", "would", "was used to"],
        answer: "used to",
        why: "Have — состояние, а would годится только для повторяющихся действий.",
      },
      {
        kind: "choice",
        prompt: "___ you use to play football at school?",
        options: ["Did", "Do", "Were"],
        answer: "Did",
        why: "Вопрос о прошлой привычке строится через did + use to.",
      },
      {
        kind: "gap",
        prompt: "I ___ (use to / think) that English was easy.",
        answer: "used to think",
        why: "Прошлое убеждение как состояние — used to + think, без would.",
      },
      {
        kind: "gap",
        prompt: "He ___ (use to / smoke) ten cigarettes a day, but he gave up.",
        answer: "used to smoke",
        why: "Регулярная привычка в прошлом — used to + глагол в начальной форме.",
      },
      {
        kind: "choice",
        prompt: "I ___ get up at six, but now I start work at noon.",
        options: ["used to", "use to", "am used to"],
        answer: "used to",
        why: "Утверждение в прошлом — used to с -d; am used to значит «привык», это другое.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Раньше я играл в теннис, но бросил».",
        options: ["I", "used", "to", "play", "tennis", "but", "I", "stopped"],
        answer: "I used to play tennis but I stopped",
        why: "Привычка в прошлом — used to + play, а вторая часть просто в Past Simple.",
      },
      {
        kind: "gap",
        prompt: "___ (use to / she / have) long hair when she was a student?",
        answer: "Did she use to have",
        why: "Вопрос о прошлой привычке строится через did, после него use to без -d, и have остаётся в начальной форме.",
      },
      {
        kind: "gap",
        prompt: "Every summer we ___ (would / swim) in the lake before breakfast.",
        answer: "would swim",
        why: "Повторяющееся действие в прошлом — здесь уместно и would swim, и used to swim; состояние would не передаёт.",
      },
      {
        kind: "gap",
        prompt: "I ___ (use to / not / like) olives, but now I love them.",
        answer: "didn't use to like",
        why: "Прошлое состояние с отрицанием: didn't use to like; вариант с would невозможен, like — не повторяющееся действие.",
      },
      {
        kind: "order",
        prompt: "Собери вопрос: «Ты раньше жил в Казани?»",
        options: ["Did", "you", "use", "to", "live", "in", "Kazan"],
        answer: "Did you use to live in Kazan",
        why: "Вопрос о прошлой привычке: Did + you + use to, причём live остаётся в первой форме.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Раньше здесь был кинотеатр».",
        options: ["There", "used", "to", "be", "a", "cinema", "here"],
        answer: "There used to be a cinema here",
        why: "Существование в прошлом — конструкция there used to be; would be с состоянием не говорят.",
      },
    ],
  },
];
