import type { TopicDraft } from "./types";

/**
 * Темы C1 на продвинутые конструкции: сослагательное после wish, инверсия и клив-предложения,
 * модальные глаголы в прошедшем.
 *
 * Контент ручной и намеренно про ТОНКОСТЬ, а не про форму: на C1 формы человек уже знает, а путает
 * should have done с needn't have done или сдвиг времён после wish. Поэтому `why` объясняет разницу
 * в смысле, а не порядок слов — иначе упражнение не учит ничему.
 */
export const C1_ADVANCED: TopicDraft[] = [
  {
    slug: "subjunctive-wish",
    category: "времена",
    title: "Wish / if only: сожаления и желания",
    level: "C1",
    rule:
      "Wish и if only переносят нас в нереальное, поэтому время после них сдвигается на шаг назад. " +
      "О нынешнем сожалении говорим через Past Simple — I wish I knew the answer (сейчас не знаю), " +
      "а о прошедшем через Past Perfect: I wish I had known (тогда не знал). " +
      "Wish + would — это уже не сожаление, а раздражение чужим поведением, которое повторяется: " +
      "I wish he would stop interrupting. " +
      "It's time и would rather берут Past Simple, когда речь о чужом действии: It's time we left, " +
      "I'd rather you didn't mention it.",
    examples: [
      "I wish I knew — сожаление о настоящем: сейчас не знаю, поэтому Past Simple после wish.",
      "I wish I had known — сожаление о прошлом: тогда не знал, поэтому had + V3.",
      "If only we had booked earlier — то же, что wish, но с эмоцией и чаще с восклицанием.",
      "It's time we made a decision — после it's time о себе и других идёт Past Simple, а не инфинитив.",
      "I'd rather you didn't mention it — о ЧУЖОМ действии would rather берёт Past Simple, хотя разговор ещё впереди.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I wish I ___ more attention during the negotiations.",
        options: ["paid", "had paid", "would pay"],
        answer: "had paid",
        why: "Сожалеем о прошедших переговорах, а не о нынешнем умении слушать: после wish о прошлом нужен Past Perfect, paid отправил бы сожаление в настоящее.",
      },
      {
        kind: "choice",
        prompt: "I wish I ___ why she left.",
        options: ["know", "knew", "had known"],
        answer: "knew",
        why: "Не знаю прямо сейчас — это нереальное настоящее, Past Simple. Had known сказало бы, что тогда, в тот вечер, я уже всё понимал.",
      },
      {
        kind: "gap",
        prompt: "If only we ___ (book) a table — everywhere is full.",
        answer: "had booked",
        why: "If only о прошлом: жалеем, что заранее не забронировали, поэтому had + V3 — ровно как после wish.",
      },
      {
        kind: "choice",
        prompt: "I'd rather you ___ that in front of the team.",
        options: ["don't mention", "didn't mention", "wouldn't mention"],
        answer: "didn't mention",
        why: "Would rather о ЧУЖОМ действии берёт Past Simple, хотя разговор только предстоит: это просьба-пожелание с оттенком упрёка, а не запрет.",
      },
      {
        kind: "gap",
        prompt: "It's time we ___ (make) a decision.",
        answer: "made",
        why: "It's time + Past Simple намекает, что время уже поджимает. Обычное it's time to make звучало бы нейтрально, без этого «хватит тянуть».",
      },
      {
        kind: "choice",
        prompt: "I wish she ___ calling me at midnight.",
        options: ["stops", "stopped", "would stop"],
        answer: "would stop",
        why: "Раздражение повторяющимся чужим поведением — это зона would. Stopped звучало бы как сожаление о единичном факте, а не как «пусть прекратит».",
      },
      {
        kind: "choice",
        prompt: "I ___ you get the offer — you've earned it.",
        options: ["hope", "wish", "wished"],
        answer: "hope",
        why: "Hope говорит о реально возможном и время не сдвигает. Wish потребовал бы «I wish you got» и означал бы, что шансов почти нет.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Жаль, что мы не знали об этом раньше».",
        options: ["I", "wish", "we", "had", "known", "about", "it", "earlier"],
        answer: "I wish we had known about it earlier",
        why: "Сожаление о прошлом: после wish — Past Perfect, а earlier стоит в конце, а не сразу после wish.",
      },
      {
        kind: "gap",
        prompt: "The trip was a washout — if only the weather ___ (be) better.",
        answer: "had been",
        why: "Сожалеем о прошедшей поездке, поэтому if only берёт Past Perfect: had been. Сказать «if only the weather were better» значило бы, что погода портится прямо сейчас и ещё можно что-то исправить.",
      },
      {
        kind: "gap",
        prompt: "If only I ___ (speak) Italian — every meeting here goes through an interpreter.",
        answer: "spoke",
        why: "Нереальное настоящее: итальянского я не знаю сейчас, поэтому после if only идёт Past Simple — spoke. Had spoken отправило бы фразу в прошлое и означало бы, что когда-то я итальянским владел.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если бы только он сказал мне раньше».",
        options: ["had", "If", "earlier", "told", "only", "me", "he"],
        answer: "If only he had told me earlier",
        why: "If only — то же сожаление, что и wish, только с большей эмоцией, и о прошлом оно точно так же берёт had + V3: had told.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Хотел бы я, чтобы ты слушал меня внимательнее».",
        options: ["would", "me", "wish", "carefully", "you", "to", "I", "listen", "more"],
        answer: "I wish you would listen to me more carefully",
        why: "Чужое поведение, которое раздражает и повторяется, — это зона wish + would: просьба «изменись». Wish you listened звучало бы как сожаление о факте в настоящем, без всякой просьбы.",
      },
      {
        kind: "choice",
        prompt: "I wish I ___ the violin as a child — sight-reading is a struggle now.",
        options: ["learned", "had learned", "would learn"],
        answer: "had learned",
        why: "Детство — закрытое прошлое, значит wish + Past Perfect: had learned. Learned перевело бы сожаление в настоящее («учусь и жалею об этом»), а would к собственному прошлому не относится вовсе.",
      },
    ],
  },
  {
    slug: "inversion-emphasis",
    category: "порядок слов",
    title: "Инверсия и выделение: Never have I, It was … that",
    level: "C1",
    rule:
      "Инверсия — это вспомогательный глагол перед подлежащим, и включается она, когда предложение " +
      "начинается с отрицательного или ограничивающего оборота: Never have I seen…, Rarely do we get…, " +
      "Not only did he miss the deadline…, Hardly had she entered when… . " +
      "Порядок тот же, что в вопросе, но вопросительного знака нет и интонация ровная. " +
      "Cleft sentences ничего не переносят, а выделяют: It was her tone that upset me (а не слова), " +
      "What I need is a break. Выделение здесь делает фразу весомой — в письменной речи это заменяет голос.",
    examples: [
      "Never have I seen such a calm negotiation — отрицательное наречие в начале, поэтому have выходит перед I.",
      "Not only did he miss the deadline, but he also lost the client — инверсия только в первой части, вторая идёт обычным порядком.",
      "Hardly had she entered when the phone rang — hardly … when требует Past Perfect и инверсии, иначе фраза рассыпается.",
      "It was her tone that upset me, not the words — cleft sentence выделяет причину, которую собеседник недооценил.",
      "What I really need is a break — псевдоклив: глагол остаётся в единственном числе, даже если дальше множественное число.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "Never ___ such a calm negotiation.",
        options: ["I have seen", "have I seen", "I saw"],
        answer: "have I seen",
        why: "Never в начале заставляет вспомогательный глагол выйти перед подлежащим. Время при этом не меняется — Present Perfect остаётся, речь об опыте до сих пор.",
      },
      {
        kind: "gap",
        prompt: "Rarely ___ (we / get) a chance like this.",
        answer: "do we get",
        why: "Rarely — отрицательное наречие, поэтому инверсия с do. Без неё фраза грамматически верна, но звучит как справка, а не как «такое выпадает редко».",
      },
      {
        kind: "choice",
        prompt: "Not only ___ the deadline, but he also lost the client.",
        options: ["he missed", "did he miss", "he did miss"],
        answer: "did he miss",
        why: "После Not only инверсия нужна только в первой части — вторая идёт обычным порядком: but he also lost. Инверсия в обеих половинах выдала бы иностранца.",
      },
      {
        kind: "gap",
        prompt: "It was her tone ___ upset me, not the words.",
        answer: "that",
        why: "Cleft sentence: it was + то, что выделяем + that. Здесь that, потому что tone — не человек; who заставило бы слушателя ждать имя.",
      },
      {
        kind: "choice",
        prompt: "Only later ___ how much the decision would cost.",
        options: ["did I realise", "I realised", "I did realise"],
        answer: "did I realise",
        why: "Only + обстоятельство в начале тоже даёт инверсию, хотя отрицания в фразе нет. Обычный порядок I realised грамматичен, но теряет выделение: именно на later падает ударение.",
      },
      {
        kind: "choice",
        prompt: "Hardly ___ the room when the phone rang.",
        options: ["he had entered", "had he entered", "he entered"],
        answer: "had he entered",
        why: "Hardly … when уже содержит отрицание, поэтому берёт Past Perfect и инверсию: hardly had he entered when. Сочетание с Past Simple здесь невозможно.",
      },
      {
        kind: "gap",
        prompt: "What I really need ___ (be) a break, not another meeting.",
        answer: "is",
        why: "В псевдокливе what … is глагол ставят в единственном числе, даже когда дальше идёт другое существительное. Are сбило бы выделение на «брейк» и превратило фразу в перечисление.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Никогда я не видел такой уверенной презентации».",
        options: ["Never", "have", "I", "seen", "such", "a", "confident", "pitch"],
        answer: "Never have I seen such a confident pitch",
        why: "Инверсия после Never: have встаёт перед I, а such a confident pitch идёт обычным порядком — переставлять там нечего.",
      },
      {
        kind: "gap",
        prompt: "No sooner ___ (he / put) the phone down than it rang again.",
        answer: "had he put",
        why: "No sooner … than требует Past Perfect и инверсии: had he put. «No sooner he had put» теряет инверсию, а без неё этот оборот в начале фразы просто не работает.",
      },
      {
        kind: "gap",
        prompt: "Not until the audit ___ (we / realise) how much had been hidden.",
        answer: "did we realise",
        why: "Not until в начале предложения тоже включает инверсию с do, хотя отрицание относится только к обстоятельству: did we realise. Обычный порядок we realised грамматичен, но звучал бы как справка, без выделения.",
      },
      {
        kind: "choice",
        prompt: "Under no circumstances ___ the lab during the experiment.",
        options: ["you should leave", "should you leave", "you leave"],
        answer: "should you leave",
        why: "Отрицательный оборот в начале — under no circumstances — требует инверсии, поэтому should выходит перед you. Форма без инверсии возможна только когда сам оборот стоит внутри фразы, а не перед подлежащим.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Не успели мы сесть, как сработала пожарная сигнализация».",
        options: ["than", "No", "we", "the", "had", "went", "sooner", "down", "alarm", "off", "sat", "fire"],
        answer: "No sooner had we sat down than the fire alarm went off",
        why: "No sooner … than — парный оборот: первая часть идёт с had и инверсией, вторая начинается с than. When вместо than — типовая ошибка, а «no sooner we had sat» теряет инверсию.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Что меня удивило, так это его спокойный тон».",
        options: ["was", "his", "What", "tone", "me", "calm", "surprised"],
        answer: "What surprised me was his calm tone",
        why: "Псевдоклив what … was выделяет причину удивления, а не сообщает новость. Were здесь не появляется, даже когда после него идёт длинная группа слов.",
      },
    ],
  },
  {
    slug: "modal-perfect",
    category: "модальные глаголы",
    title: "Модальные + have done: must / might / should / needn't",
    level: "C1",
    rule:
      "Модальный глагол с have done — это не прошедшее время, а оценка прошлого. " +
      "Must have done — уверенный вывод по фактам (свет выключен, значит они легли), can't have done — " +
      "такая же уверенность наоборот, might have done — вероятность без уверенности. " +
      "Should have done — упрёк и сожаление: не сделал, а надо было; shouldn't have done — сделал зря. " +
      "Needn't have done — сделал, а необходимости не было, в отличие от didn't need to, где действие так и не произошло.",
    examples: [
      "They must have left — по фактам делаем вывод, а не сообщаем, что они ушли когда-то.",
      "She can't have received it — уверенность, что этого не было: отрицание вывода идёт через can't, а не mustn't.",
      "You needn't have booked the tickets — билеты куплены, но нужды в этом не было; деньги потрачены зря.",
      "I didn't need to book — не бронировал, потому что было не нужно: действие просто не состоялось.",
      "I should have told him — не сказал и жалею; это упрёк себе, а не догадка о том, что было.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The lights are off — they ___ left already.",
        options: ["must have", "should have", "needn't have"],
        answer: "must have",
        why: "Мы делаем вывод по видимому факту, а не оцениваем поступок. Should have сказало бы, что им следовало уйти, — это уже совет задним числом.",
      },
      {
        kind: "choice",
        prompt: "She ___ the email — she never replied.",
        options: ["can't have received", "mustn't have received", "shouldn't have received"],
        answer: "can't have received",
        why: "Уверенность, что действие НЕ состоялось, выражается через can't have. Mustn't have — про запрет, а не про логический вывод, и здесь звучит как ошибка иностранца.",
      },
      {
        kind: "gap",
        prompt: "I ___ (should / tell) him the truth — now he trusts nobody.",
        answer: "should have told",
        why: "Не сказал, и это мучает: should have — сожаление об упущенном. Must have told значило бы, что он точно сказал, и фраза потеряла бы весь упрёк.",
      },
      {
        kind: "choice",
        prompt: "You ___ the whole report — a summary would have been enough.",
        options: ["needn't have written", "didn't need to write", "shouldn't have written"],
        answer: "needn't have written",
        why: "Отчёт написан, но пользы в этом не было — wasted effort, это needn't have. Didn't need to write сказало бы, что его и не писали вовсе.",
      },
      {
        kind: "gap",
        prompt: "He ___ (might / take) the earlier train — I'm not sure.",
        answer: "might have taken",
        why: "Модальный перфект вероятности: might have оставляет другие варианты. Must have заявило бы уверенность, которой у нас нет, — и следующие слова «I'm not sure» ей противоречили бы.",
      },
      {
        kind: "choice",
        prompt: "I ___ that joke at dinner — it clearly landed badly.",
        options: ["shouldn't have made", "needn't have made", "couldn't have made"],
        answer: "shouldn't have made",
        why: "Сделал зря и теперь себя корю — это shouldn't have, оценка поступка. Needn't have сказало бы лишь «это было необязательно», без морального суждения.",
      },
      {
        kind: "choice",
        prompt: "We ___ to reserve seats — the hall was half empty.",
        options: ["didn't need", "needn't have", "shouldn't have"],
        answer: "didn't need",
        why: "Действие не состоялось: мы не бронировали, потому что не понадобилось. Needn't have значило бы, что мы всё-таки забронировали — и зря.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Тебе не нужно было бронировать билеты так заранее».",
        options: ["You", "needn't", "have", "booked", "the", "tickets", "so", "early"],
        answer: "You needn't have booked the tickets so early",
        why: "Билеты куплены, но рано — зря: needn't have + V3. Просто needn't book отправило бы это в будущее и убрало весь смысл упрёка.",
      },
      {
        kind: "gap",
        prompt: "We ___ (could / finish) the report on Friday, but nobody wanted to stay late.",
        answer: "could have finished",
        why: "Возможность была, её не использовали, и упрёка в этом нет — could have finished. Should have finished звучало бы как «надо было закончить», то есть как претензия к себе или к команде.",
      },
      {
        kind: "gap",
        prompt: "She's not picking up — she ___ (might / leave) her phone in the car.",
        answer: "might have left",
        why: "Мы гадаем, поэтому might have оставляет другие варианты. Must have left заявило бы уверенный вывод по фактам, которых у нас нет, — и «не берёт трубку» такого вывода не даёт.",
      },
      {
        kind: "choice",
        prompt: "I ___ warned you about the closed bridge — I knew and said nothing.",
        options: ["should have", "could have", "needn't have"],
        answer: "should have",
        why: "Это упрёк себе за молчание: знал и не предупредил. Could have warned говорило бы только о моей способности предупредить, а needn't have — что я предупредил и зря.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Тебе следовало сказать мне об этом раньше».",
        options: ["me", "told", "You", "earlier", "have", "about", "it", "should"],
        answer: "You should have told me about it earlier",
        why: "Should have + V3 — упрёк за то, что не сделано: именно told, а не tell. Порядок жёсткий: should, have, третья форма — вставить между ними ничего нельзя.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он, должно быть, забыл о встрече».",
        options: ["about", "must", "He", "the", "forgotten", "have", "meeting"],
        answer: "He must have forgotten about the meeting",
        why: "Must have + V3 — уверенный вывод по фактам, а не приказ, поэтому forgotten, а не forget. Should have forgotten означало бы, что ему следовало забыть, — совсем другая мысль.",
      },
    ],
  },
];
