import { describe, expect, it } from "vitest";
import { cards } from "../src/db/schema";
import { buildLesson, lessonWords, spokenTranslation } from "../src/speech/lesson";
import { botHarness as harness, lastButtons } from "./bot-harness";
import type { SpeechSynth } from "../src/speech/tts";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("🎧 audio lesson", () => {
  it("/audio asks which accent; the lesson reads English only in it", async () => {
    const h = harness();
    await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await h.bot.handleUpdate(h.message(100, "/audio"));
    expect(lastButtons(h.calls).map((b) => b.text)).toEqual(["🇬🇧 UK", "🇺🇸 US", "🔀 Оба по очереди"]);

    const accents: string[] = [];
    const silent: SpeechSynth = { synthesize: async (_t, accent) => (accents.push(accent), tinyM4a()) };
    await buildLesson(silent, [{ term: "bank", translation: "берег", example: "" }, { term: "river", translation: "река", example: "" }], "us");
    expect(accents).toEqual(["us", "us"]);
  }, 30_000);

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

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
/** Короткая тишина в M4A — вместо настоящей озвучки. */
function tinyM4a(): Buffer {
  const out = join(mkdtempSync(join(tmpdir(), "lesson-test-")), "s.m4a");
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono", "-t", "0.1", "-c:a", "aac", out]);
  return readFileSync(out);
}
