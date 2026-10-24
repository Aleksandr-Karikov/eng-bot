import { describe, expect, it } from "vitest";
import { cards } from "../src/db/schema";
import { lessonWords, spokenTranslation } from "../src/speech/lesson";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("🎧 audio lesson", () => {
  it("keeps the spoken translation short: no brackets, two meanings at most", () => {
    expect(spokenTranslation("сдерживать (кого-то), мешать проявлять себя; испортить чью-то крутость")).toBe("сдерживать, мешать проявлять себя");
    expect(spokenTranslation("берег")).toBe("берег");
  });

  it("takes started words only, the weakest first", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    for (const term of ["strong", "weak", "fresh"]) await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: term, explanation: "", example: "" }, now: T0 });
    const [strong, weak] = await h.db.select().from(cards);
    await h.db.update(cards).set({ state: 2, stability: 30 }).where(eqId(strong.id));
    await h.db.update(cards).set({ state: 2, stability: 2 }).where(eqId(weak.id));
    expect((await lessonWords(h.db, user.id)).map((w) => w.term)).toEqual(["weak", "strong"]);
  });
});

import { eq } from "drizzle-orm";
const eqId = (id: number) => eq(cards.id, id);
