import { describe, expect, it } from "vitest";
import { digestText } from "../src/bot/texts";
import { wordUses } from "../src/db/schema";
import { createRoom, linkGroup } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { findUsedWords } from "../src/services/word-uses";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const words = ["prudent", "nail it", "spiral", "give someone the benefit of the doubt", "to ensure", "rot", "Hangar", "tone down"].map((term, i) => ({ id: i + 1, term }));
const found = (text: string) => findUsedWords(text, words).map((id) => words[id - 1].term);

describe("spotting room words in chat", () => {
  it("finds words and phrases in their usual forms", () => {
    expect(found("That was a prudent move")).toEqual(["prudent"]);
    expect(found("You totally nailed it!")).toEqual(["nail it"]);
    expect(found("we are spiraling here")).toEqual(["spiral"]);
    expect(found("I'll give him the benefit of the doubt")).toEqual(["give someone the benefit of the doubt"]);
    expect(found("Just to ensure nothing breaks")).toEqual(["to ensure"]);
    expect(found("The plane is in the hangar now")).toEqual(["Hangar"]);
    expect(found("Please tone it down")).toEqual(["tone down"]);
    expect(found("Toned down the language")).toEqual(["tone down"]);
  });

  it("ignores parts of other words and one-word messages", () => {
    expect(found("Rotation and carrots are fine")).toEqual([]);
    expect(found("Prudent?")).toEqual([]);
  });
});

describe("👏 in the group", () => {
  async function setup() {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await linkGroup(h.db, room.id, -500);
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "prudent", translation: "благоразумный", explanation: "", example: "" }, now: T0 });
    return h;
  }

  it("reacts once per word a day and counts it", async () => {
    const h = await setup();
    await h.bot.handleUpdate(h.groupMessage(100, -500, "that was a prudent idea"));
    expect(h.calls.filter((c) => c.method === "setMessageReaction").map((c) => c.payload.reaction)).toEqual([[{ type: "emoji", emoji: "👏" }]]);
    await h.bot.handleUpdate(h.groupMessage(100, -500, "very prudent again"));
    expect(h.calls.filter((c) => c.method === "setMessageReaction")).toHaveLength(1);
    expect(await h.db.select().from(wordUses)).toHaveLength(1);
  });

  it("ignores commands, private chats and unlinked groups", async () => {
    const h = await setup();
    await h.bot.handleUpdate(h.groupMessage(100, -500, "/add prudent person"));
    await h.bot.handleUpdate(h.groupMessage(100, -777, "a prudent idea"));
    await h.bot.handleUpdate(h.message(100, "a prudent idea"));
    expect(h.calls.filter((c) => c.method === "setMessageReaction")).toHaveLength(0);
  });

  it("shows up in the weekly digest", () => {
    expect(digestText("R", [{ name: "Артём", added: 0, reviews7d: 3, learned: 1, streak: 0, used: 4 }])).toContain("👏 4 в разговоре");
  });
});
