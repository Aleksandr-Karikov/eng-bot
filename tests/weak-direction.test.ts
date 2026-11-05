import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appQueue } from "../src/app/api";
import { cards, reviewLogs } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { weakDirections } from "../src/services/weak-direction";
import { botHarness, buttonData } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("weak recall direction", () => {
  it("uses several ordinary answers from both clients, then favours the weaker direction in app and bot", async () => {
    const h = botHarness({ random: () => 0 });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id,
      { modeCloze: false, modeSentence: false, modeListen: false, modeCollocation: false, modeDrill: false });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    const saved = await saveWord(h.db, { roomId: room.id, addedBy: user.id,
      draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
    if (saved.status !== "saved") throw new Error(saved.status);
    const [card] = await h.db.select().from(cards).where(eq(cards.wordId, saved.word.id));
    await h.db.update(cards).set({ state: 2, reps: 5, due: T0 }).where(eq(cards.id, card.id));
    const log = (rating: string, stage: string) => h.db.insert(reviewLogs).values({ userId: user.id, cardId: card.id, rating, stage, reviewedAt: T0 });
    await log("good", "en_ru");
    await log("again", "app_ru_en");
    expect(await weakDirections(h.db, [card.id])).toEqual(new Map());
    await log("good", "app_en_ru");
    await log("again", "ru_en");
    expect(await weakDirections(h.db, [card.id])).toEqual(new Map([[card.id, "ru_en"]]));
    expect((await appQueue(h.deps, user))[0]).toMatchObject({ stage: "ru_en" });
    await h.bot.handleUpdate(h.message(100, "/learn"));
    expect(buttonData(h.calls, "😎 Помню")).toMatch(/:r$/);

    await log("good", "ru_en");
    await log("good", "app_ru_en");
    expect(await weakDirections(h.db, [card.id])).toEqual(new Map());
  });
});
