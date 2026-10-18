import { describe, expect, it } from "vitest";
import { cardText, reverseCardText } from "../src/bot/texts";
import { ALL_PARTS, cardView, toggleCardPart } from "../src/services/card-view";
import { createRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, buttonData, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const word = {
  term: "beset by",
  translation: "осаждаемый",
  explanation: "постоянно страдает",
  example: "The project was beset by delays.",
  transcriptionUk: "/bɪˈset baɪ/",
  mnemonic: "бесы осадили",
};

describe("card view", () => {
  it("toggles parts in a compact hidden list", () => {
    expect(cardView({ cardHidden: "" })).toEqual(ALL_PARTS);
    const hidden = toggleCardPart(toggleCardPart("", "example"), "mnemonic");
    expect(cardView({ cardHidden: hidden })).toMatchObject({ example: false, mnemonic: false, explanation: true });
    expect(cardView({ cardHidden: toggleCardPart(hidden, "example") })).toMatchObject({ example: true, mnemonic: false });
  });

  it("shows only the translation when everything else is off", () => {
    const bare = { transcription: false, explanation: false, example: false, context: false, mnemonic: false, audio: false, picture: false };
    const text = cardText(word, bare);
    expect(text).toContain("<tg-spoiler>осаждаемый</tg-spoiler>");
    for (const part of ["постоянно", "delays", "бесы", "bɪˈset"]) expect(text).not.toContain(part);
    expect(reverseCardText(word, bare)).not.toContain("bɪˈset");
    expect(cardText(word)).toContain("бесы осадили");
  });

  it("is configured in /settings and applied to /learn cards and their buttons", async () => {
    const h = botHarness();
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: word, now: T0 });

    await h.bot.handleUpdate(h.message(100, "/settings"));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ 📖 Объяснение")));
    await h.bot.handleUpdate(h.callback(100, buttonData(h.calls, "✅ 🔊 Озвучка")));
    expect(cardView((await getUser(h.db, user.id))!)).toMatchObject({ explanation: false, audio: false, example: true });
    expect(lastButtons(h.calls).map((b) => b.text)).toContain("⬜️ 📖 Объяснение");

    await h.bot.handleUpdate(h.message(100, "/learn"));
    const card = String(h.calls.filter((c) => c.method === "sendMessage").at(-1)!.payload.text);
    expect(card).not.toContain("постоянно страдает");
    expect(card).toContain("delays");
    expect(lastButtons(h.calls).map((b) => b.text)).not.toContain("🔊 UK");
  });
});
