import type { TopicDraft } from "./types";

/**
 * Темы уровня A1. Контент ручной — проверяется скриптом `scripts/build-grammar.ts --dry-run`.
 *
 * Почему ручной, а не от модели: проверка ответа идёт сравнением строк, поэтому ошибка в контенте
 * означает «человек ответил верно, а бот сказал неверно». Такое нельзя генерировать на лету.
 */
export const A1_TOPICS: TopicDraft[] = [
  {
      slug: "present-simple",
      category: "времена",
      title: "Present Simple: что делаю обычно",
      level: "A1",
      rule:
        "Present Simple — про привычки, факты и расписания: то, что происходит вообще, а не прямо сейчас. " +
        "С he/she/it к глаголу добавляется -s: I work, но he works. Вопрос и отрицание делаются через do/does, " +
        "и тогда -s уходит к does: Does he work? He doesn't work.",
      examples: [
        "I work in an office — обычное место работы, не «сейчас работаю».",
        "She drinks coffee every morning — привычка.",
        "Does he live in Moscow? — вопрос через does, у глагола -s нет.",
        "They don't watch TV — отрицание через don't.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "She ___ coffee every morning.",
          options: ["drink", "drinks", "is drinking"],
          answer: "drinks",
          why: "С he/she/it в Present Simple к глаголу добавляется -s: she drinks.",
        },
        {
          kind: "gap",
          prompt: "He ___ (work) at a bank.",
          answer: "works",
          why: "He — третье лицо единственного числа, поэтому work + s.",
        },
        {
          kind: "choice",
          prompt: "___ they live in London?",
          options: ["Do", "Does", "Are"],
          answer: "Do",
          why: "С they вопрос строится через do: Do they live…",
        },
        {
          kind: "choice",
          prompt: "He ___ like fish.",
          options: ["doesn't", "don't", "isn't"],
          answer: "doesn't",
          why: "Отрицание для he — doesn't, и глагол после него без -s.",
        },
        {
          kind: "gap",
          prompt: "My sister ___ (study) at university.",
          answer: "studies",
          why: "Глагол на -y после согласной: study → studies.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она не работает по воскресеньям».",
          options: ["She", "doesn't", "work", "on", "Sundays"],
          answer: "She doesn't work on Sundays",
          why: "Отрицание: подлежащее + doesn't + глагол без -s.",
        },
        {
          kind: "choice",
          prompt: "The train ___ at 7:30.",
          options: ["leaves", "leave", "is leaving"],
          answer: "leaves",
          why: "Расписание — это Present Simple; the train — единственное число, значит leaves.",
        },
        {
          kind: "gap",
          prompt: "My brother ___ (watch) films in the evening.",
          answer: "watches",
          why: "Брат — это он, а после -ch одиночное -s не читается: правильно watches.",
        },
        {
          kind: "gap",
          prompt: "My parents ___ (not / eat) meat.",
          answer: "don't eat",
          why: "Parents — это they, поэтому don't, а смысловой глагол остаётся в начальной форме: eat.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Он часто играет в теннис по субботам».",
          options: ["plays", "He", "on", "tennis", "often", "Saturdays"],
          answer: "He often plays tennis on Saturdays",
          why: "Often ставим перед смысловым глаголом, а у he глагол play получает -s: plays.",
        },
        {
          kind: "gap",
          prompt: "Our teacher ___ (go) to school by bus.",
          answer: "goes",
          why: "Teacher — он или она, а после -o нужен -es: получается goes, а не gos.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Ты говоришь по-английски?»",
          options: ["English", "you", "Do", "speak"],
          answer: "Do you speak English",
          why: "С you вопрос строится через Do, и speak идёт без -s: окончание -s осталось бы у does.",
        },
        {
          kind: "choice",
          prompt: "My friends ___ in a big house.",
          options: ["lives", "live", "is living"],
          answer: "live",
          why: "Friends — множественное число, поэтому глагол без -s; lives подошло бы только к he/she/it.",
        },
      ],
    },
  {
      slug: "present-continuous",
      category: "времена",
      title: "Present Continuous: что делаю сейчас",
      level: "A1",
      rule:
        "Present Continuous — про действие прямо сейчас или в этот период: am/is/are + глагол с -ing. " +
        "Сравните: I work here (вообще) и I'm working now (в этот момент). Глаголы состояния " +
        "(know, like, want, need) обычно в Continuous не ставят.",
      examples: [
        "I'm reading a book — прямо сейчас.",
        "She is working from home this week — временный период.",
        "They aren't listening to us — отрицание через aren't.",
        "Are you waiting for me? — вопрос: are в начале.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "Be quiet, the baby ___ .",
          options: ["sleeps", "is sleeping", "sleep"],
          answer: "is sleeping",
          why: "Действие происходит прямо сейчас — значит Present Continuous.",
        },
        {
          kind: "gap",
          prompt: "I ___ (read) a very good book this week.",
          answer: "am reading",
          why: "Временный период (this week) — Continuous: am + reading.",
        },
        {
          kind: "choice",
          prompt: "___ you listening to me?",
          options: ["Do", "Are", "Is"],
          answer: "Are",
          why: "В Continuous вопрос строится перестановкой: Are you listening?",
        },
        {
          kind: "choice",
          prompt: "I ___ what you mean.",
          options: ["am knowing", "know", "knowing"],
          answer: "know",
          why: "Know — глагол состояния, в Continuous не употребляется.",
        },
        {
          kind: "gap",
          prompt: "They ___ (not / work) today — it's a holiday.",
          answer: "aren't working",
          why: "Отрицание в Continuous: aren't + working. Not и work пишутся через пробел, поэтому «aren't working».",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Она сейчас готовит ужин».",
          options: ["She", "is", "cooking", "dinner", "now"],
          answer: "She is cooking dinner now",
          why: "Порядок: подлежащее + is + глагол с -ing + дополнение.",
        },
        {
          kind: "gap",
          prompt: "Look! It ___ (rain).",
          answer: "is raining",
          why: "Look! — сигнал «прямо сейчас», поэтому нужно is + raining; не rains и не rain.",
        },
        {
          kind: "gap",
          prompt: "We ___ (wait) for the bus at the moment.",
          answer: "are waiting",
          why: "С we идёт are, а не am или is — подлежащее во множественном числе.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Ты сейчас пишешь письмо?»",
          options: ["Are", "you", "writing", "a", "letter", "now"],
          answer: "Are you writing a letter now",
          why: "В Continuous вопрос получается перестановкой: are выходит на первое место, -ing остаётся у смыслового глагола.",
        },
        {
          kind: "gap",
          prompt: "My parents ___ (not / listen) to music now.",
          answer: "aren't listening",
          why: "Parents — множественное, поэтому aren't; и после него сразу глагол с -ing.",
        },
        {
          kind: "gap",
          prompt: "He ___ (make) a cake right now.",
          answer: "is making",
          why: "У make конечная -e перед -ing не пишется: make → making, а не makeing.",
        },
        {
          kind: "choice",
          prompt: "My brother ___ computer games at the moment.",
          options: ["plays", "is playing", "play"],
          answer: "is playing",
          why: "At the moment — это «прямо сейчас», для такого момента нужен am/is/are + -ing, а не глагол без него.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «Сейчас я не готовлю обед».",
          options: ["I", "am", "not", "cooking", "lunch", "now"],
          answer: "I am not cooking lunch now",
          why: "В Continuous not стоит после am, а не перед глаголом: am not, и только потом cooking.",
        },
      ],
    },
  {
      slug: "plurals",
      title: "Множественное число",
      level: "A1",
      category: "множественное число",
      rule:
        "Обычное множественное — прибавь -s: book → books. После -s, -ss, -sh, -ch, -x, -z добавляется -es: " +
        "box → boxes. Согласная + y даёт -ies: city → cities, но гласная + y — просто -s: day → days. " +
        "Есть неправильные: man → men, child → children, foot → feet, tooth → teeth, mouse → mice.",
      examples: [
        "I have two books — обычное -s.",
        "Three boxes — после -x добавляется -es.",
        "Many cities — согласная + y даёт -ies.",
        "Two children — неправильная форма, не childs.",
      ],
      exercises: [
        {
          kind: "gap",
          prompt: "I bought two ___ (box) of pencils.",
          answer: "boxes",
          why: "После -x добавляется -es: box → boxes.",
        },
        {
          kind: "choice",
          prompt: "There are many ___ in Russia.",
          options: ["citys", "cities", "city"],
          answer: "cities",
          why: "Согласная + y: city → cities, y меняется на ies.",
        },
        {
          kind: "choice",
          prompt: "She has two ___ .",
          options: ["childs", "children", "childes"],
          answer: "children",
          why: "Child — неправильное: children, не childs.",
        },
        {
          kind: "gap",
          prompt: "My ___ (tooth) hurt.",
          answer: "teeth",
          why: "Tooth → teeth, как foot → feet.",
        },
        {
          kind: "choice",
          prompt: "We rested for two ___ .",
          options: ["days", "daies", "dayes"],
          answer: "days",
          why: "После гласной + y просто -s: day → days.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «У меня две сестры и три брата».",
          options: ["I", "have", "two", "sisters", "and", "three", "brothers"],
          answer: "I have two sisters and three brothers",
          why: "Обычное множественное: sister → sisters, brother → brothers.",
        },
        {
          kind: "gap",
          prompt: "My ___ (foot) are cold.",
          answer: "feet",
          why: "После are нужно множественное число, а foot меняется на feet целиком — не foots.",
        },
        {
          kind: "gap",
          prompt: "There are three ___ (woman) in the room.",
          answer: "women",
          why: "После three нужно множественное, а woman меняет корень: women, не womans.",
        },
        {
          kind: "gap",
          prompt: "There are five ___ (knife) on the table.",
          answer: "knives",
          why: "Конечная -fe переходит в -ves: knife → knives, как wife → wives.",
        },
        {
          kind: "gap",
          prompt: "The ___ (baby) are sleeping.",
          answer: "babies",
          why: "Согласная + y: y меняется на ies — babies; окончание are требует множественного.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «В классе пять учеников и три учителя».",
          options: ["There", "are", "five", "students", "and", "three", "teachers", "in", "the", "classroom"],
          answer: "There are five students and three teachers in the classroom",
          why: "После five и three нужны обычные формы на -s: students и teachers.",
        },
        {
          kind: "choice",
          prompt: "Look at those ___ !",
          options: ["sheeps", "sheep", "sheepes"],
          answer: "sheep",
          why: "Those требует множественного, но у sheep форма одна и та же: sheeps не существует.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «У нас дома два дивана и четыре стула».",
          options: ["We", "have", "two", "sofas", "and", "four", "chairs", "at", "home"],
          answer: "We have two sofas and four chairs at home",
          why: "После числительных ставим обычные формы на -s: sofas и chairs, без -es.",
        },
      ],
    },
  {
      slug: "there-is-are",
      title: "There is / there are",
      level: "A1",
      category: "согласование",
      rule:
        "There is — про одно: There is a cat. There are — про много: There are two cats. " +
        "Глагол согласуется с тем, что идёт сразу после него. Вопрос — перестановкой: Is there a shop near here? " +
        "Отрицание — через isn't / aren't.",
      examples: [
        "There is a shop on the corner — один магазин.",
        "There are many people here — много людей.",
        "Is there any milk? — вопрос с перестановкой.",
        "There aren't any chairs — отрицание.",
      ],
      exercises: [
        {
          kind: "choice",
          prompt: "___ a book on the table.",
          options: ["There is", "There are", "It is"],
          answer: "There is",
          why: "A book — одно, значит there is.",
        },
        {
          kind: "choice",
          prompt: "___ many shops in this street.",
          options: ["There is", "There are", "There have"],
          answer: "There are",
          why: "Many shops — множественное, there are.",
        },
        {
          kind: "gap",
          prompt: "___ (be) there any milk in the fridge?",
          answer: "Is",
          why: "Milk неисчисляемое — единственное число, значит is.",
        },
        {
          kind: "choice",
          prompt: "___ two cats and a dog in the yard.",
          options: ["There is", "There are", "There was"],
          answer: "There are",
          why: "Смотрим на первое существительное: two cats — множественное.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «Есть ли здесь банк рядом?»",
          options: ["Is", "there", "a", "bank", "near", "here"],
          answer: "Is there a bank near here",
          why: "Вопрос: Is + there + существительное.",
        },
        {
          kind: "choice",
          prompt: "There ___ any chairs in the room.",
          options: ["isn't", "aren't", "not are"],
          answer: "aren't",
          why: "Chairs — множественное, отрицание aren't.",
        },
        {
          kind: "order",
          prompt: "Собери вопрос: «В твоём городе есть кинотеатр?»",
          options: ["Is", "there", "a", "cinema", "in", "your", "town"],
          answer: "Is there a cinema in your town",
          why: "A cinema — одно, поэтому в вопросе на первом месте Is, а не Are.",
        },
        {
          kind: "gap",
          prompt: "There ___ (be) a lot of people in the park today.",
          answer: "are",
          why: "A lot of people — множественное, поэтому после there идёт are, хотя по-русски звучит «много».",
        },
        {
          kind: "gap",
          prompt: "There ___ (be) an apple and two oranges on the plate.",
          answer: "is",
          why: "Согласуем с первым существительным: an apple — одно, значит is, даже если дальше two oranges.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «В нашей квартире нет балкона».",
          options: ["There", "isn't", "a", "balcony", "in", "our", "flat"],
          answer: "There isn't a balcony in our flat",
          why: "Balcony в единственном числе, поэтому отрицание через isn't, а не aren't.",
        },
        {
          kind: "order",
          prompt: "Собери предложение: «В этом городе есть два музея».",
          options: ["There", "are", "two", "museums", "in", "this", "city"],
          answer: "There are two museums in this city",
          why: "Two museums — множественное, поэтому there are; с there is это предложение стало бы неверным.",
        },
        {
          kind: "choice",
          prompt: "Is there ___ water in the glass?",
          options: ["any", "a", "many"],
          answer: "any",
          why: "Water неисчисляемое: с ним в вопросе и отрицании ставим any, а не a и не many.",
        },
        {
          kind: "choice",
          prompt: "___ some water in the bottle.",
          options: ["There is", "There are", "There have"],
          answer: "There is",
          why: "Water неисчисляемое и идёт в единственном числе, поэтому there is; there have по-английски не говорят.",
        },
      ],
    },
];
