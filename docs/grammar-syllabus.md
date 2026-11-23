# Грамматика: полная программа A1–C1

Источник программы — `examenglish.com/CEFR/cefr_grammar.htm` (свод British Council / EQUALS Core
Inventory). Здесь — разбивка по нашим темам, чтобы уровни не пересекались.

## Правила для всех уровней

- **12–15 упражнений в теме.** Меньше — не хватает на тренировку; больше — тема становится длинной.
- Виды: `choice` (2–4 варианта, все осмысленные), `gap` (пропуск `___`, ответ пишется руками),
  `order` (сборка предложения). **Не больше половины упражнений темы — `choice`:** остальные должны
  требовать вспомнить форму, а не узнать её.
- В `gap` в скобках даётся подсказка-инфинитив: `He ___ (work) at a bank.` — иначе ответ неоднозначен.
- `why` объясняет **выбор**, а не пересказывает правило: «результат важен сейчас, поэтому have + V3».
- Пример из правила не повторяется дословно в упражнениях — иначе проверяется память, а не грамматика.
- `category` — строго из `MISTAKE_CATEGORIES`: времена, формы глаголов, артикли, предлоги,
  порядок слов, согласование, множественное число, модальные глаголы, выбор слова, орфография, другое.
- Вопросы не повторяются ни внутри темы, ни между темами (проверяется скриптом).
- Язык интерфейса русский; примеры и ответы — английские.

## A1 — 16 тем (было 4)

| slug | тема |
|---|---|
| present-simple ✅ | Present Simple: что делаю обычно |
| present-continuous ✅ | Present Continuous: делаю сейчас |
| plurals ✅ | Множественное число |
| there-is-are ✅ | There is / there are |
| to-be | To be: am / is / are |
| past-simple-be | Past Simple: was / were |
| possessive-adjectives | Притяжательные: my, your, his |
| possessive-s | Притяжательное 's |
| imperatives | Повелительное наклонение |
| pronouns-personal | Местоимения: I / me, he / him |
| adverbs-frequency | Наречия частоты: always, usually |
| modal-can | Can / can't: умею и могу |
| countables-much-many | Much / many, a lot of |
| going-to | Going to: планы |
| like-ing | like / hate / love + -ing |
| questions-wh | Вопросы: what, where, when |

## A2 — 16 тем (было 6)

| slug | тема |
|---|---|
| articles ✅ | Артикли: a / an / the |
| past-simple ✅ | Past Simple: правильные и неправильные |
| questions-do-does ✅ | Вопросы через do / does |
| comparatives ✅ | Сравнительная степень |
| some-any ✅ | Some / any |
| prepositions-time ✅ | Предлоги времени: in / on / at |
| superlatives | Превосходная степень |
| future-will | Will: решения и обещания |
| past-continuous-a2 | Past Continuous |
| present-perfect-a2 | Present Perfect: опыт |
| verb-patterns | want / need / would like + to |
| wh-questions-past | Wh-вопросы в прошедшем |
| zero-first-conditional | Zero и First Conditional |
| modals-should | Should: совет |
| prepositional-phrases | Предлоги места и движения |
| phrasal-verbs-basic | Фразовые глаголы: базовые |

## B1 — 20 тем (было 12)

| slug | тема |
|---|---|
| present-perfect ✅ | Present Perfect: результат к сейчас |
| present-perfect-vs-past-simple ✅ | Present Perfect vs Past Simple |
| past-continuous ✅ | Past Continuous |
| future-forms ✅ | Способы говорить о будущем |
| modals-obligation ✅ | Must / have to: обязанность |
| modals-ability ✅ | Can / could / be able to |
| conditionals-first-second ✅ | First и Second Conditional |
| used-to ✅ | Used to: раньше было |
| prepositions-place ✅ | Предлоги места |
| articles-advanced ✅ | Артикли: сложные случаи |
| word-order-questions ✅ | Порядок слов в вопросах |
| adverb-position ✅ | Место наречия в предложении |
| past-perfect | Past Perfect |
| present-perfect-continuous | Present Perfect Continuous |
| future-continuous | Future Continuous |
| question-tags | Разделительные вопросы |
| connectors | Связки: cause, contrast, result |
| intensifiers | Too / enough / so / such |
| modals-deduction | Must be / can't be: deduction |
| modals-speculation | Might / may / probably |

## B2 — 14 тем (было 6)

| slug | тема |
|---|---|
| passive-voice ✅ | Пассивный залог |
| reported-speech ✅ | Косвенная речь |
| relative-clauses ✅ | Относительные придаточные |
| gerund-infinitive ✅ | Gerund и инфинитив |
| phrasal-verbs ✅ | Фразовые глаголы |
| conditionals-third ✅ | Third Conditional |
| future-perfect | Future Perfect |
| future-perfect-continuous | Future Perfect Continuous |
| mixed-conditionals | Mixed Conditionals |
| modals-deduction-past | Can't have / needn't have |
| narrative-tenses | Narrative tenses |
| past-perfect-continuous | Past Perfect Continuous |
| wish-present | Wish: сожаление о настоящем |
| would-habits | Would: привычки в прошлом |

## C1 — 10 тем (было 3)

| slug | тема |
|---|---|
| subjunctive-wish ✅ | Subjunctive и wish |
| inversion-emphasis ✅ | Инверсия и эмфаза |
| modal-perfect ✅ | Модальные + перфект |
| cleft-sentences | Cleft sentences: It was… / What… |
| participle-clauses | Причастные обороты |
| passive-reporting | It is said that… / He is believed to… |
| future-in-past | Future in the Past |
| hedging | Seem / appear / tend to |
| relative-clauses-advanced | Non-defining и which = whole clause |
| advanced-connectors | Whereas, albeit, notwithstanding |

Итого: 76 тем, ~1000 упражнений.

## Проверка перед сдачей

```bash
npx tsx scripts/build-grammar.ts --dry-run   # контент: валидация без записи в базу
npm run typecheck
npm test
```

`--dry-run` обязателен: он ловит ответ не из вариантов, пропуск без `___`, несовпадение слов в `order`,
пустой `why`, повтор вопроса внутри и между темами.
