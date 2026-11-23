import type { TopicDraft } from "./types";

/**
 * Темы B2 — продолжение: будущие совершенные времена, смешанные условия, догадки о прошлом,
 * повествовательные времена и сожаления о настоящем.
 *
 * Здесь всё держится на одном и том же навыке: выбрать форму не по русскому переводу, а по тому,
 * что именно говорящий хочет сказать — результат к сроку или процесс, длительность или факт,
 * фон рассказа или следующий шаг. Поэтому `why` в каждом упражнении сравнивает две соседние формы.
 */
export const B2_MORE: TopicDraft[] = [
  {
    slug: "future-perfect",
    category: "времена",
    title: "Future Perfect",
    level: "B2",
    rule:
      "Future Perfect строится как will have + V3 и говорит, что действие завершится до момента в будущем: " +
      "by Friday I will have finished. Момент задаётся через by + время, by the time + событие или before + событие, " +
      "и без такого срока форма почти не нужна. Сравнивать надо не с будущим простым, а с Future Continuous: " +
      "will be doing описывает процесс, который идёт в точке будущего, а will have done — итог к этой точке. " +
      "Отрицание и вопрос строятся вокруг will: won't have finished, will you have finished.",
    examples: [
      "By the end of the week the painters will have finished the hallway — к концу недели работа будет закрыта.",
      "I won't have read the contract by Monday, so don't send it to the client yet — отрицание ставится в will.",
      "Will you have packed by the time the taxi arrives? — вопрос про результат к моменту, а не про действие в процессе.",
      "They will have replaced the old windows before winter — before задаёт срок, к которому всё готово.",
      "This time next year she will have opened her own studio — итог к дате в будущем, а не работа в тот момент.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "By the end of next month we ___ into the new office.",
        options: ["will have moved", "will be moving", "will move"],
        answer: "will have moved",
        why: "Срок «к концу месяца» требует результата, а не процесса: will be moving нарисовало бы нас с коробками в руках именно в тот момент.",
      },
      {
        kind: "choice",
        prompt: "Call me after seven — by then I ___ my report.",
        options: ["will have finished", "will be finishing", "finish"],
        answer: "will have finished",
        why: "By then — это точка отсчёта, к которой отчёт уже готов; will be finishing означало бы, что звонок застанет меня посреди работы.",
      },
      {
        kind: "choice",
        prompt: "How many countries ___ by the time you turn thirty?",
        options: ["will you have visited", "will you visit", "are you visiting"],
        answer: "will you have visited",
        why: "Считается итог к будущей дате, поэтому have + V3; will you visit спрашивало бы про намерение без счёта к сроку.",
      },
      {
        kind: "choice",
        prompt: "There's no point queueing — by the time we get in, the concert ___.",
        options: ["will have started", "will be starting", "starts"],
        answer: "will have started",
        why: "К моменту нашего входа начало уже позади, это результат; will be starting рисовало бы само начало в разгаре.",
      },
      {
        kind: "choice",
        prompt: "Come at nine — we ___ everything ready by then.",
        options: ["will have got", "will be getting", "get"],
        answer: "will have got",
        why: "By then снова требует итога к сроку: подготовка завершена, а will be getting — это ещё идущая подготовка.",
      },
      {
        kind: "choice",
        prompt: "By Friday it ___ exactly a year since we moved here.",
        options: ["will have been", "will be", "is"],
        answer: "will have been",
        why: "Ровно год ещё не наступил, он отсчитывается к пятнице — это счёт времени к сроку; will be сказало бы о состоянии в пятницу без счёта, а -ing с be невозможен вовсе.",
      },
      {
        kind: "gap",
        prompt: "By the time you get this letter, I ___ (leave) the country.",
        answer: "will have left",
        why: "Письмо придёт позже отъезда, поэтому нужен результат к моменту получения, а не will leave — он бы означал, что отъезд совпадёт с письмом.",
      },
      {
        kind: "gap",
        prompt: "She ___ (not / finish) the design by Friday at this rate.",
        answer: "won't have finished",
        why: "Отрицание ставится в will, а have + V3 остаётся неизменным: won't have finished — это «к пятнице не будет готово».",
      },
      {
        kind: "gap",
        prompt: "By 2030 the city ___ (build) three new metro lines.",
        answer: "will have built",
        why: "Год 2030 — срок, к которому три линии уже стоят; will build говорил бы только о намерении, без результата к сроку.",
      },
      {
        kind: "gap",
        prompt: "I hope the builder ___ (repair) the roof before the rain starts.",
        answer: "will have repaired",
        why: "Before + событие задаёт срок: к началу дождя ремонт должен быть закончен, отсюда have + V3.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «К шести часам мы уже приедем в отель».",
        options: ["arrived", "have", "the", "we", "six", "By", "will", "o'clock", "at", "hotel"],
        answer: "By six o'clock we will have arrived at the hotel",
        why: "Время стоит после by, потому что это срок, к которому приезд состоялся; have + arrived показывает именно завершённость к шести.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она не успеет прочитать книгу до собрания».",
        options: ["the", "before", "won't", "read", "meeting", "have", "book", "She", "the"],
        answer: "She won't have read the book before the meeting",
        why: "Before the meeting — срок, к которому чтение не завершится; отрицание живёт в won't, а не в have.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Сколько ты накопишь к декабрю?»",
        options: ["saved", "will", "December", "much", "by", "How", "you", "have"],
        answer: "How much will you have saved by December",
        why: "Вопрос строится через will you have + V3, и by December стоит в конце как срок, к которому накопление завершено.",
      },
    ],
  },
  {
    slug: "future-perfect-continuous",
    category: "времена",
    title: "Future Perfect Continuous",
    level: "B2",
    rule:
      "Future Perfect Continuous — will have been + -ing: действие будет длиться до момента в будущем, и говорящий " +
      "подчёркивает именно протяжённость. Обязателен показатель длительности: for two hours, since May, all morning. " +
      "Разница с Future Perfect смысловая: will have written three chapters — результат, will have been writing for " +
      "six hours — сколько времени к тому моменту набежит. С состояниями (know, have, be, own) форма не используется: " +
      "там остаётся will have + V3, потому что у состояния нет процесса.",
    examples: [
      "By the time we land, we will have been flying for eleven hours — важен не результат, а сколько часов продлится полёт.",
      "In May she will have been running this team for five years — длительность к дате, а не факт назначения.",
      "I'll have been waiting at the gate since two, so please hurry — since + начало отсчёта подчёркивает протяжённость.",
      "By next winter they will have known each other for a decade — know состояние, поэтому без -ing.",
      "How long will you have been studying by the time you sit the exam? — вопрос именно о накопленной длительности.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "By July I ___ for this company for ten years.",
        options: ["will have been working", "will be working", "am working"],
        answer: "will have been working",
        why: "For ten years — накопленная длительность к июлю, её и подчёркивает have been + -ing; will be working сказало бы лишь, что в июле я работаю.",
      },
      {
        kind: "choice",
        prompt: "By June I ___ this car for ten years.",
        options: ["will have had", "will have been having", "will be having"],
        answer: "will have had",
        why: "Have — состояние, процесса у него нет, поэтому been + -ing невозможен даже при длинном сроке: остаётся Future Perfect.",
      },
      {
        kind: "choice",
        prompt: "By Friday she ___ three chapters.",
        options: ["will have written", "will have been writing", "will write"],
        answer: "will have written",
        why: "Считается результат — три главы, а не потраченное время, поэтому будет Future Perfect, а не форма с been + -ing.",
      },
      {
        kind: "choice",
        prompt: "When the new term starts, we ___ English for three years.",
        options: ["will have been learning", "will learn", "are learning"],
        answer: "will have been learning",
        why: "For three years к началу семестра — это протяжённость, отсюда will have been + -ing; will learn вообще не про срок.",
      },
      {
        kind: "choice",
        prompt: "By the time the film ends, I ___ for eight hours.",
        options: ["will have been working", "will work", "am working"],
        answer: "will have been working",
        why: "Восемь часов набегут к концу фильма — важна длительность, а не сделанная работа, поэтому been + -ing.",
      },
      {
        kind: "gap",
        prompt: "By the time she retires, she ___ (teach) for forty years.",
        answer: "will have been teaching",
        why: "Сорок лет — это ровно та протяжённость, ради которой существует форма have been + -ing; will have taught сказало бы о результате, а не о сроке.",
      },
      {
        kind: "gap",
        prompt: "By 8 p.m. they ___ (drive) for twelve hours straight.",
        answer: "will have been driving",
        why: "Straight и for twelve hours подчёркивают непрерывность, поэтому к восьми вечера действие всё ещё длится — been + -ing.",
      },
      {
        kind: "gap",
        prompt: "How long ___ (you / wait) by the time the doctor sees you?",
        answer: "will you have been waiting",
        why: "How long спрашивает о длительности к моменту приёма, значит нужен will you have been + -ing, а не will you have waited.",
      },
      {
        kind: "gap",
        prompt: "By the time you arrive, I ___ (cook) all morning.",
        answer: "will have been cooking",
        why: "All morning — отрезок, который к твоему приходу ещё не закончится, поэтому процесс с накопленной длительностью.",
      },
      {
        kind: "gap",
        prompt: "Next month it ___ (rain) in this valley for half a year.",
        answer: "will have been raining",
        why: "For half a year — срок, и дождь всё ещё идёт к следующему месяцу, поэтому have been raining, а не have rained.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «К концу месяца он будет работать над проектом уже год».",
        options: ["working", "a", "the", "will", "have", "month", "By", "end", "of", "on", "he", "the", "been", "the", "for", "project", "year"],
        answer: "By the end of the month he will have been working on the project for a year",
        why: "For a year в конце показывает, что к концу месяца наберётся ровно год работы — ради этого и нужен been + working.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «К пятнице мы будем готовить этот отчёт уже две недели».",
        options: ["preparing", "have", "this", "weeks", "By", "for", "been", "Friday", "will", "report", "two", "we"],
        answer: "By Friday we will have been preparing this report for two weeks",
        why: "Две недели подготовки — длительность к пятнице; will have prepared сказало бы, что отчёт готов, но здесь речь о сроке работы.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «К тому времени она будет жить здесь уже десять лет».",
        options: ["living", "for", "been", "she", "will", "years", "here", "By", "have", "then", "ten"],
        answer: "By then she will have been living here for ten years",
        why: "Live здесь как процесс, тянущийся к моменту в будущем, поэтому have been + -ing; форма с have lived звучала бы как итог, а не как срок.",
      },
    ],
  },
  {
    slug: "mixed-conditionals",
    category: "времена",
    title: "Mixed Conditionals",
    level: "B2",
    rule:
      "Mixed Conditional нужен, когда условие и следствие относятся к разному времени. Прошлое условие даёт настоящее " +
      "следствие: if + had + V3, ... would + инфинитив — If I had studied medicine, I would be a doctor now. " +
      "Обратное смешение: постоянное свойство в настоящем объясняет прошлый поступок — if + past simple / were, ... " +
      "would have + V3 — If I were braver, I would have said yes. Ключ — наречия времени: now, today, right now " +
      "тянут следствие в настоящее, yesterday, last week — в прошлое. В следствии про настоящее have исчезает.",
    examples: [
      "If I had learned to drive years ago, I would be driving to work now — прошлое решение объясняет сегодняшнюю зависимость от автобуса.",
      "If she had invested in that flat, she would be renting it out now — не купила тогда, поэтому сейчас не сдаёт.",
      "If he were a morning person, he would have caught the early train — свойство в настоящем, а следствие в прошлом.",
      "If you didn't hate flying, we would have gone to Lisbon in June — отношение к полётам сейчас сорвало поездку тогда.",
      "If we had moved to the coast, our kids would be going to a different school now — прошлое переехало бы настоящее в другую школу.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "If I had taken that course, I ___ fluent in Spanish today.",
        options: ["would be", "would have been", "will be"],
        answer: "would be",
        why: "Today переносит следствие в настоящее, поэтому have из следствия уходит: mixed, а не чистый третий тип.",
      },
      {
        kind: "choice",
        prompt: "If I hadn't quit my job, I ___ in an office right now.",
        options: ["would be sitting", "would have sat", "sit"],
        answer: "would be sitting",
        why: "Right now — следствие в настоящем и в процессе, поэтому would be + -ing; would have sat отправило бы результат в прошлое.",
      },
      {
        kind: "choice",
        prompt: "If I ___ harder at school, I would have a better job now.",
        options: ["had worked", "worked", "would work"],
        answer: "had worked",
        why: "Школа в прошлом, а работа сейчас — значит условие строится через had + V3, хотя следствие стоит в would + инфинитив.",
      },
      {
        kind: "choice",
        prompt: "If it weren't for the traffic, we ___ our train yesterday.",
        options: ["would have caught", "would catch", "had caught"],
        answer: "would have caught",
        why: "Причина в настоящем (пробки), но поезд был вчера, поэтому следствие требует would have + V3 — обратное смешение.",
      },
      {
        kind: "choice",
        prompt: "If you were more organised, you ___ your passport yesterday.",
        options: ["wouldn't have forgotten", "wouldn't forget", "didn't forget"],
        answer: "wouldn't have forgotten",
        why: "Характер в настоящем (were) объясняет вчерашний промах, а следствие относится к прошлому, поэтому would have + V3.",
      },
      {
        kind: "gap",
        prompt: "If she ___ (not / miss) the flight, she would be in Madrid right now.",
        answer: "hadn't missed",
        why: "Следствие с right now — настоящее, но пропущенный рейс в прошлом, поэтому условие через hadn't + V3.",
      },
      {
        kind: "gap",
        prompt: "If we had bought that flat in 2019, we ___ (own) it outright by now.",
        answer: "would own",
        why: "By now относит результат в настоящее, поэтому would + инфинитив без have — хотя условие в прошлом.",
      },
      {
        kind: "gap",
        prompt: "If he ___ (be) more careful with money, he wouldn't be broke today.",
        answer: "had been",
        why: "Он остался без денег уже сейчас, а промахи с деньгами были раньше: условие про прошлое — had been, а не were.",
      },
      {
        kind: "gap",
        prompt: "I ___ (not / be) so tired now if I had slept properly.",
        answer: "wouldn't be",
        why: "Now в главной части требует чистого would без have, хотя условие с had slept остаётся прошедшим.",
      },
      {
        kind: "gap",
        prompt: "You ___ (speak) French fluently now if you had kept practising.",
        answer: "would speak",
        why: "Навык был бы сейчас, отсюда would + инфинитив; would have spoken сказало бы, что ты уже поговорил по-французски в прошлом.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если бы я не ушёл с той работы, я был бы сейчас в Лондоне».",
        options: ["be", "would", "that", "I", "London", "hadn't", "in", "left", "If", "now", "I", "job"],
        answer: "If I hadn't left that job I would be in London now",
        why: "Уход был в прошлом (hadn't left), а Лондон — сейчас (would be); have в следствии не появляется.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если бы ты больше читал, ты бы сдал экзамен в прошлом году».",
        options: ["passed", "read", "would", "you", "the", "more", "have", "exam", "If", "you", "last", "year"],
        answer: "If you read more you would have passed the exam last year",
        why: "Привычка читать — про настоящее, а экзамен в прошлом году, поэтому условие в past simple, а следствие с would have + V3.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Если бы мы жили ближе, мы бы пришли вчера».",
        options: ["come", "closer", "would", "we", "lived", "have", "yesterday", "If", "we"],
        answer: "If we lived closer we would have come yesterday",
        why: "Lived — постоянное обстоятельство сейчас, come yesterday — прошлый визит; смешение даёт were-подобное условие с would have.",
      },
    ],
  },
  {
    slug: "modals-deduction-past",
    category: "модальные глаголы",
    title: "Can't have / needn't have",
    level: "B2",
    rule:
      "Догадка о прошлом строится через модальный глагол + have + V3: must have done — почти уверен, " +
      "can't have done — уверен, что этого не было, might/may have done — возможно. Отдельно стоит needn't have + V3: " +
      "действие сделали, а делать его было незачем. Не путать с didn't need to do — не сделали, потому что не требовалось. " +
      "Mustn't have + V3 в значении догадки не употребляется: запрет и уверенность — разные вещи, для невозможности только can't.",
    examples: [
      "The road is wet, so it must have rained during the night — уверенный вывод по видимому следу.",
      "She can't have heard you — she had headphones on — не могла услышать, это исключено.",
      "I needn't have cooked — they had already eaten — приготовил, а зря.",
      "You needn't have waited for me; I had a key — ждал, хотя в этом не было нужды.",
      "He might have taken the wrong bus — возможно, но не наверняка.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "The lights are off — they ___ gone to bed.",
        options: ["must have", "can't have", "needn't have"],
        answer: "must have",
        why: "Свет выключен — это улика, из которой делают уверенный вывод: must have, а can't have означало бы обратное.",
      },
      {
        kind: "choice",
        prompt: "He ___ the email yet — I only sent it five minutes ago.",
        options: ["can't have read", "mustn't have read", "needn't have read"],
        answer: "can't have read",
        why: "Пять минут исключают прочтение, а невозможность передаётся только can't have; mustn't говорят о запрете, а не о догадке.",
      },
      {
        kind: "choice",
        prompt: "This cake is amazing — you ___ it yourself.",
        options: ["can't have made", "mustn't have made", "needn't have made"],
        answer: "can't have made",
        why: "Торт слишком хорош, чтобы быть домашним: это вывод «не может быть», отсюда can't have, а needn't have сказало бы «испек, но зря».",
      },
      {
        kind: "choice",
        prompt: "I ___ the report — the meeting was cancelled, so it never got written.",
        options: ["didn't need to write", "needn't have written", "mustn't have written"],
        answer: "didn't need to write",
        why: "Отчёт так и не написан: didn't need to do — не было нужды и действия не было; needn't have written значит «написал зря».",
      },
      {
        kind: "choice",
        prompt: "You ___ the wine — we already had three bottles in the cupboard.",
        options: ["needn't have brought", "didn't need to bring", "mustn't have brought"],
        answer: "needn't have brought",
        why: "Вино принесли, и оно стоит на столе — значит действие было, но лишнее: это needn't have; didn't need to bring сказало бы, что не принесли.",
      },
      {
        kind: "gap",
        prompt: "They ___ the turning — they're twenty minutes late. (must / miss)",
        answer: "must have missed",
        why: "Опоздание на двадцать минут — достаточная улика для уверенного вывода, поэтому must + have + V3, а не must miss.",
      },
      {
        kind: "gap",
        prompt: "You ___ about the tickets — I had already bought them. (not / worry)",
        answer: "needn't have worried",
        why: "Человек волновался, а зря: действие было, но ненужное — только needn't have + V3, не didn't need to.",
      },
      {
        kind: "gap",
        prompt: "We ___ a table — the restaurant was half empty. (needn't / book)",
        answer: "needn't have booked",
        why: "Столик забронировали, хотя свободных было полно: needn't have booked фиксирует и действие, и его ненужность.",
      },
      {
        kind: "gap",
        prompt: "It's no use calling now — he ___ already. (might / leave)",
        answer: "might have left",
        why: "Уверенности нет, есть лишь вероятность, поэтому might + have + V3; must have left звучало бы как твёрдый вывод.",
      },
      {
        kind: "gap",
        prompt: "She ___ us — she was looking the other way. (can't / see)",
        answer: "can't have seen",
        why: "Она смотрела в другую сторону, значит увидеть было невозможно: отрицание ставится в can't, а have + V3 остаётся.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Они, должно быть, забыли о встрече».",
        options: ["forgotten", "meeting", "They", "about", "have", "must", "the"],
        answer: "They must have forgotten about the meeting",
        why: "Это уверенный вывод по факту, поэтому must идёт первым, а forgotten — после have: must have forgotten.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Тебе не нужно было покупать хлеб».",
        options: ["bread", "have", "the", "You", "bought", "needn't"],
        answer: "You needn't have bought the bread",
        why: "Хлеб куплен, но надобности не было — это needn't have + V3; didn't need to buy сказало бы, что покупки не случилось.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она не могла прочитать эту книгу за один вечер».",
        options: ["evening", "have", "read", "one", "can't", "She", "in", "book", "that"],
        answer: "She can't have read that book in one evening",
        why: "За вечер такое не прочитать — это невозможность, а не запрет, поэтому can't have read, а не mustn't have read.",
      },
    ],
  },
  {
    slug: "narrative-tenses",
    category: "времена",
    title: "Narrative tenses",
    level: "B2",
    rule:
      "В рассказе три времени делят работу. Past Continuous рисует фон: что уже шло, когда случилось главное — " +
      "we were driving along the coast. Past Simple двигает сюжет: каждое новое действие — следующий шаг — " +
      "the engine died, I called a garage, we waited. Past Perfect отступает назад, к тому, что случилось раньше " +
      "точки рассказа — the neighbours had already called the police. Порядок в тексте не равен порядку событий: " +
      "past perfect может стоять после, но говорить о более раннем.",
    examples: [
      "It was raining and the streets were empty when the taxi finally arrived — Continuous держит сцену, Simple вводит событие.",
      "She picked up the phone, dialled the number and waited — цепочка Simple, каждый глагол двигает рассказ.",
      "The flat looked untouched: nobody had opened the windows for months — Perfect объясняет, почему сцена такая.",
      "While I was signing the form, the manager came in and sat down — фон и два шага сюжета в одном предложении.",
      "He had never flown before, so he watched the safety video twice — состояние до полёта, а не действие в полёте.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "When I arrived, they ___ dinner.",
        options: ["were having", "had had", "have had"],
        answer: "were having",
        why: "Ужин шёл в момент моего прихода — это фон, поэтому Continuous; had had сказало бы, что ужин закончился до меня.",
      },
      {
        kind: "choice",
        prompt: "He ___ in Berlin for ten years before he moved to Rome.",
        options: ["had lived", "lived", "was living"],
        answer: "had lived",
        why: "Before he moved задаёт точку, и берлинская жизнь целиком до неё, поэтому Past Perfect, а не Simple.",
      },
      {
        kind: "choice",
        prompt: "I ___ my keys, so I couldn't get in.",
        options: ["had lost", "lost", "was losing"],
        answer: "had lost",
        why: "Потеря случилась раньше, чем выяснилось, что войти нельзя: причина до следствия — Past Perfect.",
      },
      {
        kind: "choice",
        prompt: "When we left the house, it ___ heavily.",
        options: ["was raining", "had rained", "rained"],
        answer: "was raining",
        why: "Дождь шёл в момент выхода — это описание обстановки, а не завершённое действие до него.",
      },
      {
        kind: "choice",
        prompt: "She ___ the letter, read it twice and put it away.",
        options: ["opened", "had opened", "was opening"],
        answer: "opened",
        why: "Три глагола подряд — это цепочка шагов сюжета, каждый следующий; Perfect здесь разорвал бы последовательность.",
      },
      {
        kind: "gap",
        prompt: "We ___ (drive) along the coast when the engine suddenly died.",
        answer: "were driving",
        why: "Поломка врывается в уже идущий процесс: фон — Continuous, а died уже двигает сюжет.",
      },
      {
        kind: "gap",
        prompt: "By the time the ambulance arrived, the neighbours ___ (already / call) the police.",
        answer: "had already called",
        why: "Звонок в полицию был раньше приезда скорой, поэтому Past Perfect с already, а не Past Simple.",
      },
      {
        kind: "gap",
        prompt: "While she ___ (cook), the children were playing in the garden.",
        answer: "was cooking",
        why: "While соединяет два одновременных фоновых процесса, значит обе части в Continuous, а не в Simple.",
      },
      {
        kind: "gap",
        prompt: "The train ___ (leave) at six, so we got up at five.",
        answer: "left",
        why: "Отправление — факт расписания, один шаг в цепочке рассказа; had left означало бы, что поезд ушёл до того, как мы встали.",
      },
      {
        kind: "gap",
        prompt: "Nobody answered the door — they ___ (go) out.",
        answer: "had gone",
        why: "Уход произошёл до стука в дверь, это объяснение пустой квартиры, поэтому Past Perfect.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Когда мы вошли, фильм уже начался».",
        options: ["in", "already", "the", "started", "walked", "When", "had", "we", "film"],
        answer: "When we walked in the film had already started",
        why: "Вход — шаг сюжета (walked), а начало фильма было раньше него, поэтому had already started.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она посмотрела на часы и поняла, что опоздала на автобус».",
        options: ["had", "looked", "she", "the", "bus", "at", "missed", "her", "watch", "She", "and", "realised"],
        answer: "She looked at her watch and realised she had missed the bus",
        why: "Looked и realised — последовательные шаги, а опоздание на автобус случилось до них, отсюда had missed.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Пока мы ждали, кто-то позвонил в дверь».",
        options: ["rang", "waiting", "somebody", "the", "While", "we", "were", "doorbell"],
        answer: "While we were waiting somebody rang the doorbell",
        why: "While держит ожидание как фон в Continuous, а звонок — событие, которое этот фон прерывает, поэтому rang.",
      },
    ],
  },
  {
    slug: "past-perfect-continuous",
    category: "времена",
    title: "Past Perfect Continuous",
    level: "B2",
    rule:
      "Past Perfect Continuous — had been + -ing: действие длилось до момента в прошлом, и говорящий показывает " +
      "его протяжённость. Нужен показатель длительности — for two hours, since morning, all night. " +
      "Разница с Past Perfect такая же, как в будущем: had been waiting — сколько ждал, had waited — что сделал к сроку. " +
      "С состояниями (know, have, be, own, like) форма не используется, там остаётся had + V3: had known him for years.",
    examples: [
      "They had been arguing for an hour when I walked in — важен не результат ссоры, а её длительность к моему приходу.",
      "She had been working at the bakery since spring, so she knew all the regulars — длительность объясняет знание.",
      "We had known each other for years before we started dating — know состояние, поэтому Past Perfect без -ing.",
      "The pavement was wet: it had been raining all morning — след в настоящем от долгого процесса в прошлом.",
      "How long had you been waiting when the office finally opened? — вопрос именно о накопленном времени.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "She ___ for two hours when the phone rang.",
        options: ["had been studying", "had studied", "was studying"],
        answer: "had been studying",
        why: "For two hours — накопленная длительность к звонку, её показывает been + -ing; had studied говорило бы об итоге, was studying — о процессе без счёта.",
      },
      {
        kind: "choice",
        prompt: "I ___ him for years before we finally met.",
        options: ["had known", "had been knowing", "knew"],
        answer: "had known",
        why: "Know — состояние, -ing с ним невозможен, поэтому длительность выражается через Past Perfect.",
      },
      {
        kind: "choice",
        prompt: "The kitchen smelled of bread — someone ___.",
        options: ["had been baking", "has been baking", "bakes"],
        answer: "had been baking",
        why: "Запах описывается в прошлом, значит и процесс до него был в прошлом: had been + -ing, а has been утянул бы всё в настоящее.",
      },
      {
        kind: "choice",
        prompt: "How long ___ before the rain started?",
        options: ["had they been driving", "had they driven", "were they driving"],
        answer: "had they been driving",
        why: "How long спрашивает о длительности до момента в прошлом, поэтому had been + -ing; were driving не содержит счёта времени.",
      },
      {
        kind: "choice",
        prompt: "It was clear that she ___ all night — her eyes were red.",
        options: ["had been crying", "had cried", "cried"],
        answer: "had been crying",
        why: "All night и красные глаза указывают на долгий процесс с видимым следом, а не на однократное действие had cried.",
      },
      {
        kind: "gap",
        prompt: "They ___ (wait) since morning when the bus finally came.",
        answer: "had been waiting",
        why: "Since morning задаёт начало отсчёта, и ожидание тянется до прихода автобуса — значит been + -ing, а не had waited.",
      },
      {
        kind: "gap",
        prompt: "By the time I found the office, I ___ (walk) for forty minutes.",
        answer: "had been walking",
        why: "Сорок минут набежали к моменту, когда офис нашёлся: длительность до прошлой точки — Past Perfect Continuous.",
      },
      {
        kind: "gap",
        prompt: "She ___ (not / sleep) well for weeks, so she went to the doctor.",
        answer: "hadn't been sleeping",
        why: "For weeks — долгий процесс до визита к врачу, и именно он стал причиной; отрицание ставится в hadn't.",
      },
      {
        kind: "gap",
        prompt: "The ground was wet because it ___ (rain) since dawn.",
        answer: "had been raining",
        why: "Since dawn и мокрая земля дают процесс, шедший до момента в прошлом, поэтому had been raining, а не had rained.",
      },
      {
        kind: "gap",
        prompt: "He ___ (play) tennis for an hour when it started raining.",
        answer: "had been playing",
        why: "For an hour к началу дождя — это срок игры, а не её результат, поэтому форма с been + -ing.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он работал здесь уже год, когда его повысили».",
        options: ["for", "working", "here", "when", "been", "was", "a", "year", "He", "promoted", "had", "he"],
        answer: "He had been working here for a year when he was promoted",
        why: "For a year до повышения — длительность, поэтому had been working; had worked означало бы «проработал и закончил».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Мы ждали двадцать минут, когда автобус наконец пришёл».",
        options: ["waiting", "bus", "when", "for", "been", "the", "twenty", "finally", "had", "came", "We", "minutes"],
        answer: "We had been waiting for twenty minutes when the bus finally came",
        why: "Двадцать минут ожидания — фон к приходу автобуса, отсюда had been waiting, а не had waited.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Она готовила с самого утра, когда приехали гости».",
        options: ["cooking", "morning", "had", "guests", "since", "She", "when", "arrived", "been", "the"],
        answer: "She had been cooking since morning when the guests arrived",
        why: "Since morning подчёркивает, что готовка шла долго до приезда гостей, — только been + -ing передаёт эту протяжённость.",
      },
    ],
  },
  {
    slug: "wish-present",
    category: "времена",
    title: "Wish: сожаление о настоящем",
    level: "B2",
    rule:
      "I wish + past simple говорит о сожалении по поводу настоящего: I wish I knew her number — не знаю сейчас. " +
      "После wish время сдвигается на шаг назад, поэтому вместо I am говорят I were, вместо I have — I had, " +
      "вместо I can — I could. Для раздражения и просьбы об изменении к лучшему берут would: I wish it would stop. " +
      "Wish не ставится с will и с формой настоящего времени после него — это самая частая ошибка.",
    examples: [
      "I wish I had more free time — сейчас его нет, отсюда had вместо have.",
      "I wish I were better at maths — were после wish норма для всех лиц, включая I.",
      "I wish I could remember his name — could заменяет can, потому что речь о нехватке сейчас.",
      "I wish my neighbour would turn his music down — would выражает раздражение и надежду на изменение.",
      "I wish you didn't have to leave so early — сожаление о нынешнем положении, а не о прошлом.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "I wish I ___ how to swim.",
        options: ["knew", "know", "had known"],
        answer: "knew",
        why: "Плавать не умею сейчас, поэтому после wish нужен past simple; had known отправило бы сожаление в прошлое.",
      },
      {
        kind: "choice",
        prompt: "I wish I ___ taller — none of these jackets fit.",
        options: ["were", "am", "had been"],
        answer: "were",
        why: "Wish сдвигает настоящее на шаг назад, а для be это were во всех лицах; am после wish невозможно.",
      },
      {
        kind: "choice",
        prompt: "I wish she ___ calling me at midnight — it drives me mad.",
        options: ["would stop", "stopped", "stops"],
        answer: "would stop",
        why: "Это раздражение от повторяющегося поведения и надежда на перемену, поэтому would + инфинитив; stopped звучало бы как констатация.",
      },
      {
        kind: "choice",
        prompt: "I wish we ___ a bigger flat, but we can't afford one.",
        options: ["had", "have", "would have"],
        answer: "had",
        why: "Речь о том, чего нет сейчас: have после wish не ставится, а would have означало бы просьбу о будущем.",
      },
      {
        kind: "choice",
        prompt: "I ___ you get the job — fingers crossed!",
        options: ["hope", "wish", "wished"],
        answer: "hope",
        why: "Пожелание о будущем выражается через hope + present; wish здесь означал бы сожаление о том, что уже не так.",
      },
      {
        kind: "gap",
        prompt: "I wish I ___ (can) drive — the buses here are hopeless.",
        answer: "could",
        why: "Нехватка умения сейчас передаётся через could, потому что can после wish не остаётся в настоящей форме.",
      },
      {
        kind: "gap",
        prompt: "I wish I ___ (not / have) to work this weekend.",
        answer: "didn't have",
        why: "Сожаление о нынешнем положении: have сдвигается в had, а в отрицании появляется вспомогательный didn't.",
      },
      {
        kind: "gap",
        prompt: "He wishes he ___ (not / live) so far from work.",
        answer: "didn't live",
        why: "Он живёт далеко и сейчас — значит present regret, и после wish нужен past simple, а не live.",
      },
      {
        kind: "gap",
        prompt: "I wish it ___ (not / rain) so much in this city.",
        answer: "didn't rain",
        why: "Разговор о постоянной особенности места, где мы находимся, поэтому past simple после wish; had not rained говорило бы о конкретном прошлом дожде.",
      },
      {
        kind: "gap",
        prompt: "I wish you ___ (stop) making that noise — I'm trying to concentrate.",
        answer: "would stop",
        why: "Просьба-жалоба с надеждой на перемену требует would + инфинитив, а не stopped, который звучит как факт.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Жалею, что не знаю её номер».",
        options: ["number", "I", "wish", "knew", "her", "I"],
        answer: "I wish I knew her number",
        why: "Номер неизвестен сейчас, поэтому после wish стоит knew; know сломал бы сдвиг времени.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Жаль, что я не умею готовить».",
        options: ["could", "wish", "cook", "I", "I"],
        answer: "I wish I could cook",
        why: "Could заменяет can после wish: неумение относится к настоящему, но форма уходит на шаг назад.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Жаль, что у нас нет сада».",
        options: ["garden", "wish", "had", "a", "I", "we"],
        answer: "I wish we had a garden",
        why: "Сада нет сейчас — сожаление о настоящем, поэтому had вместо have после wish.",
      },
    ],
  },
  {
    slug: "would-habits",
    category: "модальные глаголы",
    title: "Would: привычки в прошлом",
    level: "B2",
    rule:
      "Would + инфинитив описывает повторяющееся поведение в прошлом — обычно в рассказе о детстве или о старых " +
      "временах: every summer we would go to the village. Смысл близок к used to, но есть разница: used to " +
      "говорит и о состояниях, и о действиях, а would — только о повторяющихся действиях. С have, know, be, live, " +
      "own, like would не употребляется: I would have a bike здесь невозможно, только I used to have. " +
      "В отрицании и вопросе would в этом значении почти не встречается — там естественнее used to.",
    examples: [
      "On Sundays my father would read the paper on the balcony — повторяющееся действие в рассказе.",
      "We used to have a dog when I was little — состояние, поэтому used to, а не would.",
      "She would always bring sweets when she visited — привычка с оттенком «так было принято».",
      "He used to work night shifts before the kids were born — факт прошлой жизни, а не повторяющийся эпизод.",
      "Whenever it snowed, the children would build a fort in the yard — would после указателя повторяемости.",
    ],
    exercises: [
      {
        kind: "choice",
        prompt: "When we were kids, my grandfather ___ tell us stories every evening.",
        options: ["would", "will", "is used to"],
        answer: "would",
        why: "Это повторявшееся действие в прошлом, поэтому would + инфинитив; will перенёс бы привычку в настоящее.",
      },
      {
        kind: "choice",
        prompt: "I ___ a bike when I was ten, and I rode it everywhere.",
        options: ["used to have", "would have", "was having"],
        answer: "used to have",
        why: "Have — состояние, а не повторяющееся действие, поэтому would невозможен: остаётся used to have.",
      },
      {
        kind: "choice",
        prompt: "She ___ in Manchester before she moved here.",
        options: ["used to live", "would live", "was used to live"],
        answer: "used to live",
        why: "Live как постоянное место жительства — состояние прошлого, поэтому used to; форма was used to live смешивает две разные конструкции.",
      },
      {
        kind: "choice",
        prompt: "Every Sunday we ___ to the market with my mother.",
        options: ["would go", "will go", "are going"],
        answer: "would go",
        why: "Every Sunday задаёт повторяемость в прошлом, поэтому would + go; will go описывает нынешнюю привычку.",
      },
      {
        kind: "choice",
        prompt: "There ___ a cinema on this corner when I was a child.",
        options: ["used to be", "would be", "was used to be"],
        answer: "used to be",
        why: "Be — состояние, would с ним не работает, а was used to be — соединение двух конструкций в одну неверную.",
      },
      {
        kind: "gap",
        prompt: "On rainy days we ___ (would / play) cards for hours.",
        answer: "would play",
        why: "Play — действие, которое повторялось, поэтому would + инфинитив без -ed и без to.",
      },
      {
        kind: "gap",
        prompt: "There ___ (use to / be) a bakery on this street.",
        answer: "used to be",
        why: "Наличие магазина — состояние в прошлом, а would состояний не берёт, поэтому только used to be.",
      },
      {
        kind: "gap",
        prompt: "Whenever it snowed, the children ___ (would / build) a snowman in the yard.",
        answer: "would build",
        why: "Whenever прямо указывает на повторяемость, а build — действие, значит would + голая форма глагола.",
      },
      {
        kind: "gap",
        prompt: "My grandmother ___ (use to / own) a small shop near the station.",
        answer: "used to own",
        why: "Own — состояние владения, а не повторяющееся действие, поэтому used to, не would.",
      },
      {
        kind: "gap",
        prompt: "In those years he ___ (would / walk) to the factory at five in the morning.",
        answer: "would walk",
        why: "Ежедневная дорога на работу — повторявшееся действие, поэтому would walk; used to walk тоже возможно, но would точнее передаёт «так было заведено».",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «В детстве мы каждое лето ездили к бабушке».",
        options: ["summer", "would", "grandmother", "every", "to", "our", "we", "children", "go", "As"],
        answer: "As children we would go to our grandmother every summer",
        why: "Go — действие, повторявшееся каждое лето, поэтому would + go; для состояния здесь понадобилось бы used to.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Раньше здесь был рынок».",
        options: ["be", "to", "market", "There", "used", "a", "here"],
        answer: "There used to be a market here",
        why: "Бытие в прошлом — состояние, а would be в этом значении не употребляется, поэтому used to be.",
      },
      {
        kind: "order",
        prompt: "Собери предложение: «Он всегда носил эту шляпу».",
        options: ["hat", "wear", "always", "would", "that", "He"],
        answer: "He would always wear that hat",
        why: "Always подчёркивает повторяемость, а wear — действие, поэтому would + инфинитив без -ed.",
      },
    ],
  },
];
