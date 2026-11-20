import { describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { grammarExercises, grammarProgress, grammarTopics } from "../src/db/schema";
import { answerExercise, isCorrect, listTopics, topicView } from "../src/services/grammar-topics";
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
    // В упражнении, которое видит клиент, ответа нет — иначе проверять нечего.
    for (const exercise of view!.exercises) expect(exercise).not.toHaveProperty("answer");
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
