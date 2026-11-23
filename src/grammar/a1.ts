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
          prompt: "___ there any milk in the fridge?",
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
      ],
    },
];
