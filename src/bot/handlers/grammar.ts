import type { Bot } from "grammy";
import { eq } from "drizzle-orm";
import { grammarExercises, grammarTopics } from "../../db/schema";
import {
  answerExercise,
  listTopics,
  topicView,
  type AnswerResult,
  type ExerciseView,
  type TopicSummary,
  type TopicView,
} from "../../services/grammar-topics";
import { decodeCb } from "../callbacks";
import { background, HTML, type BotContext, type Deps } from "../context";
import { esc, plural } from "../texts";

/**
 * 📘 Грамматика: темы, упражнения и экзамен.
 *
 * По образцу наборов слов, но **без модели в проверке**: контент лежит в базе вместе с ответами, верность
 * считается сравнением строк. Поэтому человек жмёт кнопку и сразу видит результат — здесь нет ожидания
 * LLM, которое в проекте уже приводило к «модель не ответила» посреди задания.
 *
 * Модель зовётся ровно в одном месте — на «почему так». И там её сбой ничего не ломает: объяснение из
 * контента показано сразу, а подробный ответ приходит в личку фоном, если модель ответила.
 */
export function registerGrammar(bot: Bot<BotContext>, deps: Deps): void {
  bot.command("grammar", async (ctx) => {
    const topics = await listTopics(deps.db, ctx.user.id);
    if (topics.length === 0) {
      // Человеку нечего делать с путём к скрипту: контент приезжает вместе с кодом при обновлении бота,
      // поэтому честный текст — «ещё не готово», а не инструкция для разработчика.
      return void (await ctx.reply("📘 Грамматика пока готовится — темы появятся в ближайшее обновление.\nА пока можно учить слова: /learn"));
    }
    await ctx.reply(listText(topics), { ...HTML, reply_markup: listKeyboard(topics) });
  });

  bot.callbackQuery(/^gr$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const topics = await listTopics(deps.db, ctx.user.id);
    await edit(ctx, listText(topics), listKeyboard(topics));
  });

  bot.callbackQuery(/^gt:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "grammarTopic") return;
    const view = await topicView(deps.db, ctx.user.id, cb.topicId);
    if (!view) return void (await edit(ctx, "Тема не найдена — возможно, контент обновили."));
    await edit(ctx, topicText(view), topicKeyboard(view));
  });

  // Показ упражнения отдельно от ответа: сначала видно задание и варианты, потом нажатие.
  bot.callbackQuery(/^gq:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    await ctx.answerCallbackQuery();
    if (cb?.k !== "grammarQuestion") return;
    const data = await exerciseWithTopic(deps, cb.exerciseId);
    if (!data) return void (await edit(ctx, "Упражнение не найдено."));
    const view = await topicView(deps.db, ctx.user.id, data.topic.id);
    if (!view) return;
    const exercise = view.exercises.find((e) => e.id === cb.exerciseId);
    if (!exercise) return void (await edit(ctx, "Упражнение не найдено."));
    await edit(ctx, questionText(view, exercise), questionKeyboard(view, exercise));
  });

  bot.callbackQuery(/^ga:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "grammarAnswer") return void (await ctx.answerCallbackQuery());
    const data = await exerciseWithTopic(deps, cb.exerciseId);
    if (!data) return void (await ctx.answerCallbackQuery({ text: "Упражнение не найдено" }));
    const view = await topicView(deps.db, ctx.user.id, data.topic.id);
    const exercise = view?.exercises.find((e) => e.id === cb.exerciseId);
    if (!view || !exercise) return void (await ctx.answerCallbackQuery({ text: "Упражнение не найдено" }));

    const picked = exercise.options[cb.index];
    if (picked === undefined) return void (await ctx.answerCallbackQuery({ text: "Такого варианта нет" }));
    // Комната для урона — текущая: грамматика бьёт по боссу той комнаты, где человек учится.
    const result = await answerExercise(deps.db, {
      userId: ctx.user.id, exerciseId: cb.exerciseId, answer: picked, now: deps.now(), roomId: ctx.user.currentRoomId ?? undefined,
    });
    if (!result) return void (await ctx.answerCallbackQuery({ text: "Упражнение не найдено" }));
    await ctx.answerCallbackQuery({ text: result.correct ? "Верно!" : "Мимо" });

    const fresh = await topicView(deps.db, ctx.user.id, view.id);
    if (!fresh) return;
    await edit(ctx, answerText(fresh, exercise, result, picked), answerKeyboard(fresh, exercise, result));
  });

  /**
   * «Почему так» — единственное место, где зовётся модель.
   *
   * Объяснение из контента уже у человека, поэтому здесь не ждём: сразу отвечаем на нажатие и уходим в фон.
   * Модель ответила — присылаем подробнее в личку; не ответила — остаётся объяснение из контента.
   */
  bot.callbackQuery(/^gw:/, async (ctx) => {
    const cb = decodeCb(ctx.callbackQuery.data);
    if (cb?.k !== "grammarWhy") return void (await ctx.answerCallbackQuery());
    await ctx.answerCallbackQuery({ text: "Спрошу подробнее и пришлю в личку" });
    const data = await exerciseWithTopic(deps, cb.exerciseId);
    if (!data) return;
    const { topic, exercise } = data;
    const user = ctx.user;
    background(ctx, async () => {
      try {
        // Спрашиваем только если провайдер умеет: проверка ответов моделью не пользуется, это отдельная
        // необязательная возможность. Нет метода — присылаем объяснение из контента.
        const body = deps.tutor.explainGrammar
          ? (await deps.tutor.explainGrammar({ rule: topic.rule, task: exercise.prompt, answer: exercise.answer })).trim()
          : "";
        await deps.notifier.dm(user, `<b>Почему так</b>\n\n${esc(body || exercise.why)}`, HTML);
      } catch (err) {
        // Модель не ответила — это не ошибка для человека: объяснение из контента у него уже есть.
        console.error("Grammar why failed", topic.slug, err);
        await deps.notifier.dm(user, `<b>Почему так</b>\n\n${esc(exercise.why)}`, HTML);
      }
    });
  });
}

/** Правка сообщения: в группе под кнопкой всегда наше сообщение, но в личке оно тоже есть. */
async function edit(ctx: BotContext, text: string, keyboard?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }) {
  try {
    await ctx.editMessageText(text, keyboard ? { ...HTML, reply_markup: keyboard } : { ...HTML });
  } catch {
    // Сообщение могло не измениться — Telegram отвечает ошибкой «message is not modified». Это не сбой.
    await ctx.reply(text, keyboard ? { ...HTML, reply_markup: keyboard } : { ...HTML });
  }
}

/** Упражнение и его тема: нужны, чтобы перерисовать экран после ответа. */
async function exerciseWithTopic(deps: Deps, exerciseId: number) {
  const [exercise] = await deps.db.select().from(grammarExercises).where(eq(grammarExercises.id, exerciseId));
  if (!exercise) return undefined;
  const [topic] = await deps.db.select().from(grammarTopics).where(eq(grammarTopics.id, exercise.topicId));
  return topic ? { topic, exercise } : undefined;
}

function listText(topics: TopicSummary[]): string {
  const passed = topics.filter((t) => t.passed).length;
  const lines = topics.map((t) => {
    const mark = t.passed ? "✅" : t.done > 0 ? `📖 ${t.done}/${t.total}` : "▫️";
    return `${mark} <b>${esc(t.title)}</b> · ${esc(t.level)}`;
  });
  const tail = passed > 0
    ? `Сдано тем: ${passed} из ${topics.length}.`
    : "Выбери тему: сначала правило, потом упражнения.";
  return ["📘 <b>Грамматика</b>", "", ...lines, "", tail].join("\n");
}

function listKeyboard(topics: TopicSummary[]) {
  return {
    inline_keyboard: topics.map((t) => [{ text: `${t.passed ? "✅" : t.done > 0 ? "📖" : "📘"} ${t.title}`, callback_data: `gt:${t.id}` }]),
  };
}

function topicText(view: TopicView): string {
  const lines = [
    `📘 <b>${esc(view.title)}</b> · ${esc(view.level)}`,
    "",
    esc(view.rule),
  ];
  if (view.examples.length) {
    lines.push("", "<b>Примеры</b>");
    for (const example of view.examples) lines.push(`• ${esc(example)}`);
  }
  const progress = view.done > 0 ? ` · пройдено ${view.done} из ${view.total}` : "";
  lines.push("", `Упражнений: ${view.total}${progress}`);
  if (view.passed) lines.push("Тема сдана — можно вернуться к любой теме.");
  return lines.join("\n");
}

function topicKeyboard(view: TopicView) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  // Первое непройденное — точка входа; всё пройдено — начинаем сначала, повторить полезно.
  const next = view.exercises.find((e) => !e.solved) ?? view.exercises[0];
  if (next) rows.push([{ text: view.done > 0 && !view.passed ? "▶ Продолжить" : "▶ Начать", callback_data: `gq:${next.id}` }]);
  rows.push([{ text: "← К темам", callback_data: "gr" }]);
  return { inline_keyboard: rows };
}

function questionText(view: TopicView, exercise: ExerciseView): string {
  return [
    `📘 <b>${esc(view.title)}</b> · ${view.done + 1} из ${view.total}`,
    "",
    esc(exercise.prompt),
  ].join("\n");
}

function questionKeyboard(view: TopicView, exercise: ExerciseView) {
  const rows = exercise.options.map((option, index) => [
    { text: option.slice(0, 60), callback_data: `ga:${exercise.id}:${index}` },
  ]);
  rows.push([{ text: "← К теме", callback_data: `gt:${view.id}` }]);
  return { inline_keyboard: rows };
}

/** Экран ответа: верно или нет, правильный ответ, объяснение из контента и что дальше. */
function answerText(view: TopicView, exercise: ExerciseView, result: AnswerResult, picked: string): string {
  const lines = [
    result.correct ? "✅ <b>Верно</b>" : "❌ <b>Неверно</b>",
    "",
    esc(exercise.prompt),
    "",
    result.correct ? `<b>${esc(result.answer)}</b>` : `Ты: ${esc(picked)}\nПравильно: <b>${esc(result.answer)}</b>`,
  ];
  if (result.why) lines.push("", esc(result.why));
  // Урон боссу: показываем только когда он начислен, чтобы не пугать выключивших режим.
  if (result.bossDamage > 0) lines.push("", `🐉 Боссу: −${result.bossDamage} HP`);
  const left = result.total - result.done;
  lines.push(
    "",
    result.passed
      ? "🎉 Тема сдана!"
      : `Пройдено ${result.done} из ${result.total}${left > 0 ? ` · осталось ${left} ${plural(left, "упражнение", "упражнения", "упражнений")}` : ""}`,
  );
  return lines.join("\n");
}

function answerKeyboard(view: TopicView, exercise: ExerciseView, result: AnswerResult) {
  const rows: Array<Array<{ text: string; callback_data: string }>> = [];
  const next = view.exercises.find((e) => !e.solved && e.id !== exercise.id);
  if (next) rows.push([{ text: "▶ Дальше", callback_data: `gq:${next.id}` }]);
  // Единственная кнопка, которая зовёт модель; при верном ответе тоже полезна — «почему именно так».
  rows.push([{ text: "💡 Почему так?", callback_data: `gw:${exercise.id}` }]);
  rows.push([{ text: "← К теме", callback_data: `gt:${view.id}` }]);
  void result;
  return { inline_keyboard: rows };
}
