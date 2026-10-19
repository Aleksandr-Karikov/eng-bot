import { describe, expect, it } from "vitest";
import { cardText } from "../src/bot/texts";
import { words } from "../src/db/schema";
import { addExample, knownWords } from "../src/capture/capture";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { getWord, saveWord } from "../src/services/words";
import { dropCard } from "../src/services/cards";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

async function setup() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true, captureKey: "k" });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  for (const [term, context] of [["frazzled", "I'm totally frazzled today."], ["bank", ""]]) {
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term, translation: `t-${term}`, explanation: "", example: "", context }, now: T0 });
  }
  return { h, user };
}

describe("known words for the extension", () => {
  it("lists the words I learn in the current room, without the ones I dropped", async () => {
    const { h, user } = await setup();
    await dropCard(h.db, user.id, 2);
    expect(await knownWords(h.deps, "k")).toEqual({ ok: true, words: [{ id: 1, term: "frazzled", translation: "t-frazzled" }] });
    expect(await knownWords(h.deps, "nope")).toMatchObject({ ok: false, status: 401 });
  });

  it("«📍 Ещё пример» keeps a new line next to the word, the first one becomes the main context", async () => {
    const { h } = await setup();
    expect(await addExample(h.deps, { key: "k", wordId: 1, context: "She looked frazzled after the meeting.", title: "The Bear" })).toMatchObject({ ok: true, added: [{ term: "frazzled" }] });
    expect(await addExample(h.deps, { key: "k", wordId: 1, context: "She looked frazzled after the meeting." })).toMatchObject({ ok: true, added: [], duplicates: ["frazzled"] });
    await addExample(h.deps, { key: "k", wordId: 2, context: "We sat on the river bank." });
    const frazzled = (await getWord(h.db, 1))!;
    expect(JSON.parse(frazzled.moreContexts)).toEqual([{ text: "She looked frazzled after the meeting.", title: "The Bear" }]);
    expect((await getWord(h.db, 2))?.context).toBe("We sat on the river bank.");
    const text = cardText(frazzled);
    expect(text).toContain("📍 <i>I'm totally <b>frazzled</b> today.</i>");
    expect(text).toContain("📍 <i>She looked <b>frazzled</b> after the meeting.</i> <i>(The Bear)</i>");
    void words;
  });
});
