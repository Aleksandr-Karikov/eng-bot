import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { combatSpends, grammarExercises, grammarProgress, grammarTopics, mistakes } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { goalProgress } from "../src/services/goals";
import { updateUser } from "../src/services/users";
import { createApp } from "../src/app/server";
import { sign } from "@telegram-apps/init-data-node";
import { answerExercise, isCorrect, listTopics, syncGrammar, topicView } from "../src/services/grammar-topics";
import { GRAMMAR_TOPICS } from "../src/grammar-content";
import { botHarness } from "./bot-harness";
import { makeUser, testDb, T0 } from "./helpers";

/** Залить одну тему в базу — как это делает scripts/build-grammar.ts, но без файла базы. */
async function seed(h: ReturnType<typeof botHarness>, topic = GRAMMAR_TOPICS[0]) {
  const [created] = await h.db.insert(grammarTopics).values({
    slug: topic.slug,
    title: topic.title,
    level: topic.level,
    language: "en",
    category: topic.category,
    rule: topic.rule,
    examples: topic.examples.join("\n"),
    position: 0,
    createdAt: T0,
  }).returning();
  await h.db.insert(grammarExercises).values(topic.exercises.map((e, position) => ({
    topicId: created.id,
    kind: e.kind,
    prompt: e.prompt,
    options: (e.options ?? []).join("\n"),
    answer: e.answer,
    why: e.why,
    position,
  })));
  return created;
}

describe("📘 grammar content", () => {
  it("has a rule, examples and exercises in every topic", () => {
    expect(GRAMMAR_TOPICS.length).toBeGreaterThanOrEqual(3);
    for (const topic of GRAMMAR_TOPICS) {
      expect(topic.title.length).toBeGreaterThan(0);
      expect(topic.rule.length).toBeGreaterThan(20);
      expect(topic.examples.length).toBeGreaterThan(0);
      expect(topic.exercises.length).toBeGreaterThan(0);
    }
  });

  it("never writes an exercise without an explanation", () => {
    // Без `why` ошибка ничему не учит, а модель зовётся только по кнопке — значит объяснение обязано быть.
    for (const topic of GRAMMAR_TOPICS) {
      for (const exercise of topic.exercises) expect(exercise.why.trim().length).toBeGreaterThan(0);
    }
  });

  it("keeps the answer reachable from the options", () => {
    // Иначе человек не сможет ответить верно ни одним нажатием: проверка сравнивает строки дословно.
    for (const topic of GRAMMAR_TOPICS) {
      for (const exercise of topic.exercises) {
        if (exercise.kind === "choice") expect(exercise.options ?? []).toContain(exercise.answer);
        if (exercise.kind === "gap") expect(exercise.prompt).toContain("___");
        if (exercise.kind === "order") {
          const words = [...(exercise.options ?? [])].sort().join(" ");
          expect([...exercise.answer.split(/\s+/)].sort().join(" ")).toBe(words);
        }
      }
    }
  });
});

describe("📘 answer checking never needs a model", () => {
  it("compares the answer as text, ignoring case and extra spaces", () => {
    expect(isCorrect("gap", "works", "works")).toBe(true);
    expect(isCorrect("gap", "  Works  ", "works")).toBe(true);
    expect(isCorrect("gap", "works ", " works")).toBe(true);
    // Частичный ответ — не верный: «works» это не «work».
    expect(isCorrect("gap", "work", "works")).toBe(false);
    expect(isCorrect("choice", "drink", "drinks")).toBe(false);
    // Перестановка слов нормализуется по пробелам, поэтому двойные пробелы не ломают ответ.
    expect(isCorrect("order", "She doesn't work", "She doesn't  work")).toBe(true);
  });

  it("shows progress and marks a topic passed only after every exercise", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h);
    const exercises = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    expect(exercises.length).toBeGreaterThan(1);

    // Отвечаем верно по порядку — тема закрывается только на последнем.
    for (const [i, exercise] of exercises.entries()) {
      const result = await answerExercise(h.db, { userId: user.id, exerciseId: exercise.id, answer: exercise.answer, now: T0 });
      expect(result?.correct).toBe(true);
      expect(result?.done).toBe(i + 1);
      expect(result?.passed).toBe(i === exercises.length - 1);
      // Объяснение приходит из контента, а не от модели.
      expect(result?.why).toBe(exercise.why);
    }
    expect((await listTopics(h.db, user.id))[0]).toMatchObject({ done: exercises.length, passed: true });
  });

  it("does not advance on a wrong answer and keeps the progress it had", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h);
    const exercises = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));

    const wrong = await answerExercise(h.db, { userId: user.id, exerciseId: exercises[0].id, answer: "совсем не то", now: T0 });
    expect(wrong).toMatchObject({ correct: false, done: 0, passed: false });
    // Правильный ответ всё равно показан — иначе ошибка ничему не учит.
    expect(wrong?.answer).toBe(exercises[0].answer);

    await answerExercise(h.db, { userId: user.id, exerciseId: exercises[0].id, answer: exercises[0].answer, now: T0 });
    const again = await answerExercise(h.db, { userId: user.id, exerciseId: exercises[1].id, answer: "мимо", now: T0 });
    // Прогресс не откатывается: он уже был, ошибка его не отнимает.
    expect(again).toMatchObject({ correct: false, done: 1 });
  });

  it("cannot be finished by answering one easy exercise over and over", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h);
    const exercises = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));

    // Отвечаем верно только на первое — сколько бы раз ни нажимали, дальше не продвинемся.
    for (let i = 0; i < 5; i++) {
      await answerExercise(h.db, { userId: user.id, exerciseId: exercises[0].id, answer: exercises[0].answer, now: T0 });
    }
    const [row] = await h.db.select().from(grammarProgress).where(eq(grammarProgress.userId, user.id));
    expect(row).toMatchObject({ done: 1, passed: false });
  });

  it("never sends the answer to the client before it is chosen", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h);
    const view = await topicView(h.db, user.id, topic.id);
    expect(view).toBeDefined();
    // В упражнении, которое видит клиент, ответа нет ни полем, ни единственным вариантом:
    // иначе проверять нечего — правильный вариант был бы виден в исходниках экрана.
    for (const exercise of view!.exercises) {
      expect(Object.keys(exercise)).not.toContain("answer");
      expect(Object.keys(exercise)).not.toContain("key");
      const rows = await h.db.select().from(grammarExercises).where(eq(grammarExercises.id, exercise.id));
      // Верный ответ обязан быть среди кнопок, но не единственным — иначе выбор мнимый.
      expect(exercise.options).toContain(rows[0].answer);
      expect(exercise.options.length).toBeGreaterThan(1);
    }
  });
});

describe("📘 /grammar in the bot", () => {
  it("lists topics and opens a topic with its rule", async () => {
    const h = botHarness();
    await makeUser(h.db, 100, "Alice");
    const topic = await seed(h);
    await h.bot.handleUpdate(h.message(100, "/grammar"));
    const list = String(h.calls.at(-1)?.payload.text);
    expect(list).toContain("Грамматика");
    expect(list).toContain("Present Simple");

    // Открываем тему настоящей кнопкой — так же, как это сделает человек.
    await h.bot.handleUpdate(h.callback(100, `gt:${topic.id}`));
    const topicText = String(h.calls.at(-1)?.payload.text);
    expect(topicText).toContain("Present Simple");
    expect(topicText).toContain("he works");
  });

  it("checks the answer without calling the model", async () => {
    const h = botHarness();
    await makeUser(h.db, 100, "Alice");
    const topic = await seed(h);
    const exercises = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    const first = exercises[0];
    const index = (first.options ?? "").split("\n").indexOf(first.answer);
    // Считаем обращения к модели: при проверке ответа их быть не должно.
    let called = 0;
    h.deps.tutor.explainGrammar = async () => {
      called += 1;
      return "";
    };

    await h.bot.handleUpdate(h.callback(100, `gq:${first.id}`));
    const question = String(h.calls.at(-1)?.payload.text);
    // Задание видно, а ответа в тексте нет — он только на кнопках.
    expect(question).toContain("Present Simple");
    expect(question).toContain("___");
    expect(question).not.toContain(first.answer);

    await h.bot.handleUpdate(h.callback(100, `ga:${first.id}:${index}`));
    const answer = String(h.calls.at(-1)?.payload.text);
    expect(answer).toContain("Верно");
    expect(answer).toContain(first.why);

    // Модель для проверки не звалась вовсе — это главное свойство: ответ не зависит от её доступности.
    // Модель для проверки не звалась: explainGrammar тоже не тронут.
    expect(called).toBe(0);
  });

  it("shows the content explanation even when the model fails on «why»", async () => {
    const h = botHarness();
    await makeUser(h.db, 100, "Alice");
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    // Модель недоступна: кнопка «почему так» всё равно должна дать объяснение.
    h.deps.tutor.explainGrammar = async () => {
      throw new Error("model down");
    };
    await h.bot.handleUpdate(h.callback(100, `gw:${first.id}`));
    await vi.waitFor(() => {
      const sent = h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
      expect(sent.some((t) => t.includes(first.why))).toBe(true);
    });
  });

  it("asks the model for a deeper explanation when it is available", async () => {
    const h = botHarness();
    await makeUser(h.db, 100, "Alice");
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    h.deps.tutor.explainGrammar = async () => "Потому что подлежащее в третьем лице.";
    await h.bot.handleUpdate(h.callback(100, `gw:${first.id}`));
    await vi.waitFor(() => {
      const sent = h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
      expect(sent.some((t) => t.includes("третьем лице"))).toBe(true);
    });
  });
});

// 🔗 Грамматика не отдельная игра: промах идёт в общую работу над ошибками, ответ даёт урон боссу.
describe("🔗 grammar is wired into mistakes and the boss", () => {
  it("records a wrong answer in the shared mistake list with the topic's category", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h, GRAMMAR_TOPICS[2]); // артикли
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));

    await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: "чушь", now: T0 });
    const logged = await h.db.select().from(mistakes).where(eq(mistakes.userId, user.id));
    expect(logged).toHaveLength(1);
    // Категория — из тех же, что ставит /check, иначе слабые места копились бы в двух местах.
    expect(logged[0].category).toBe("артикли");
    expect(logged[0].right).toBe(first.answer);
  });

  it("does not record a correct answer as a mistake", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0 });
    expect(await h.db.select().from(mistakes).where(eq(mistakes.userId, user.id))).toHaveLength(0);
  });

  it("deals damage to the room's boss and never twice for the same exercise", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));

    const once = await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0, roomId: room.id });
    // Верный ответ весит как сложное упражнение — 2 HP.
    expect(once?.bossDamage).toBe(2);

    // Повторное нажатие на то же упражнение урона не добавляет: requestId уникален в базе.
    const twice = await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0, roomId: room.id });
    expect(twice?.bossDamage).toBe(0);
    expect(await h.db.select().from(combatSpends).where(eq(combatSpends.roomId, room.id))).toHaveLength(1);
  });

  it("gives no damage when the boss mode is off", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    await updateUser(h.db, user.id, { modeBoss: false });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    const result = await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0, roomId: room.id });
    expect(result?.bossDamage).toBe(0);
  });

  it("counts grammar damage in the room's weekly progress", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const topic = await seed(h);
    const exercises = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));
    for (const exercise of exercises.slice(0, 2)) {
      await answerExercise(h.db, { userId: user.id, exerciseId: exercise.id, answer: exercise.answer, now: T0, roomId: room.id });
    }
    // Два верных ответа по 2 HP — и они видны боссу как удары, а не лежат отдельно.
    const progress = await goalProgress(h.db, room, T0);
    expect(progress.done).toBeCloseTo(4, 1);
    expect(progress.byUser[0]).toMatchObject({ name: "Alice", count: 4 });
  });
});

// 📱 Экран Mini App: он ходит в /api/grammar, поэтому проверяем именно эндпоинты, а не только сервис.
describe("📱 grammar in the Mini App", () => {
  const TOKEN = "123:test-token";
  /** Приложение с подписанным пользователем — как настоящий Mini App. */
  async function appHarness() {
    const h = botHarness();
    const user = await makeUser(h.db, 100, "Alice");
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "Alice" } }, TOKEN, new Date())}` };
    return { h, user, app, headers };
  }

  it("lists topics and opens one", async () => {
    const { h, app, headers } = await appHarness();
    await seed(h);
    const list = await (await app.request("/api/grammar", { headers })).json();
    expect(list.ok).toBe(true);
    expect(list.topics).toHaveLength(1);
    expect(list.topics[0]).toMatchObject({ title: "Present Simple: что делаю обычно", passed: false });

    const one = await (await app.request(`/api/grammar/${list.topics[0].id}`, { headers })).json();
    expect(one.topic.rule.length).toBeGreaterThan(20);
    expect(one.topic.exercises.length).toBeGreaterThan(0);
    // Ответа на клиенте нет — проверять будет сервер.
    expect(one.topic.exercises[0]).not.toHaveProperty("answer");
  });

  it("checks an answer on the server and deals boss damage", async () => {
    const { h, app, headers, user } = await appHarness();
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await updateUser(h.db, user.id, { currentRoomId: room.id });
    const topic = await seed(h);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id));

    const post = async (body: object) => {
      const res = await app.request("/api/grammar/answer", {
        method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return res.json() as Promise<{ result: { correct: boolean; answer: string; why: string; done: number; bossDamage: number } }>;
    };

    // Ошибка на первом упражнении: разбор показан, счётчик не продвинулся.
    const wrong = await post({ exerciseId: first.id, answer: "мимо" });
    expect(wrong.result).toMatchObject({ correct: false, answer: first.answer, done: 0 });
    expect(wrong.result.why).toBe(first.why);

    // Верный ответ на СЛЕДУЮЩЕЕ упражнение: на то же самое повторно урона не будет — requestId уникален.
    const second = (await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topic.id)))[1];
    const right = await post({ exerciseId: second.id, answer: second.answer });
    expect(right.result.correct).toBe(true);
    // Урон идёт в текущую комнату — экран показывает его же.
    expect(right.result.bossDamage).toBe(2);
  });

  it("rejects a missing or unknown exercise instead of failing silently", async () => {
    const { app, headers } = await appHarness();
    const noAnswer = await app.request("/api/grammar/answer", {
      method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ exerciseId: 1 }),
    });
    expect(noAnswer.status).toBe(400);
    const unknown = await app.request("/api/grammar/answer", {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ exerciseId: 999_999, answer: "x" }),
    });
    expect(unknown.status).toBe(404);
  });
});

// 🚀 Контент едет вместе с кодом: темы заливаются при старте бота, а не руками через скрипт.
// Это и убирает сообщение «залей скриптом» у человека, которому оно ничего не говорит.
describe("🚀 grammar content ships with the code", () => {
  it("fills every topic on the first start", async () => {
    const h = botHarness();
    const synced = await syncGrammar(h.db, T0);
    expect(synced.topics).toBe(GRAMMAR_TOPICS.length);
    expect(synced.exercises).toBe(GRAMMAR_TOPICS.reduce((n, t) => n + t.exercises.length, 0));
    // Ни одной темы с пустым правилом или без упражнений — иначе экран открылся бы пустым.
    for (const topic of await listTopics(h.db, 1)) {
      expect(topic.total).toBeGreaterThan(0);
    }
  });

  it("does not duplicate topics or reset progress on a restart", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    await syncGrammar(h.db, T0);
    const topics = await listTopics(h.db, user.id);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topics[0].id));
    await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0 });
    const before = (await h.db.select().from(grammarProgress).where(eq(grammarProgress.userId, user.id)))[0];

    // Второй и третий запуск — как перезапуски бота при деплое.
    await syncGrammar(h.db, T0);
    await syncGrammar(h.db, T0);

    // Тема одна и та же, а прогресс человека не пострадал: иначе каждый деплой обнулял бы пройденное.
    expect(await h.db.select().from(grammarTopics)).toHaveLength(GRAMMAR_TOPICS.length);
    const after = (await h.db.select().from(grammarProgress).where(eq(grammarProgress.userId, user.id)))[0];
    expect(after.done).toBe(before.done);
    expect(after.done).toBeGreaterThan(0);
  });

  it("resets a topic's progress only when its exercises actually changed", async () => {
    const h = botHarness();
    const user = await makeUser(h.db, 1, "Alice");
    await syncGrammar(h.db, T0);
    const topics = await listTopics(h.db, user.id);
    const [first] = await h.db.select().from(grammarExercises).where(eq(grammarExercises.topicId, topics[0].id));
    await answerExercise(h.db, { userId: user.id, exerciseId: first.id, answer: first.answer, now: T0 });

    // Имитируем старый контент в базе: расходится с кодом.
    await h.db.update(grammarExercises).set({ prompt: "старый вопрос" }).where(eq(grammarExercises.id, first.id));
    await syncGrammar(h.db, T0);

    // Контент вернулся к коду, значит упражнения сменились — пройденное по ним больше не актуально.
    const after = (await h.db.select().from(grammarProgress).where(eq(grammarProgress.userId, user.id)))[0];
    expect(after.done).toBe(0);
    expect(after.passed).toBe(false);
  });

  it("never tells a person to run a script", async () => {
    const h = botHarness();
    await makeUser(h.db, 100, "Alice");
    // Пустая база: контента ещё нет (первый старт не прошёл).
    await h.bot.handleUpdate(h.message(100, "/grammar"));
    const text = String(h.calls.at(-1)?.payload.text);
    // Человек не может запустить скрипт — сообщение не должно его об этом просить.
    expect(text).not.toContain("npx tsx");
    expect(text).not.toContain("scripts/");
    expect(text).toContain("Грамматика");
  });
});
