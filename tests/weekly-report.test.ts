import { describe, expect, it } from "vitest";
import { weeklyReportText } from "../src/bot/texts";
import { cards, mistakes, reviewLogs } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { getUser, updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { collectWeeklyReports, weeklyReport } from "../src/services/weekly-report";
import { makeUser, testDb } from "./helpers";

// Новосибирск = UTC+7. Неделя: вс 11.10 20:00 — вс 18.10 20:00.
const nsk = (iso: string) => new Date(`${iso}+07:00`);

async function setup() {
  const db = testDb();
  const user = await updateUser(db, (await makeUser(db, 100)).id, { canDm: true });
  const room = await createRoom(db, { name: "R", createdBy: user.id, now: nsk("2026-10-01T10:00") });
  for (const term of ["bank", "snag", "rot"]) {
    await saveWord(db, { roomId: room.id, addedBy: user.id, draft: { term, translation: "t", explanation: "", example: "" }, now: nsk("2026-10-01T10:00") });
  }
  const log = (cardId: number, rating: string, at: string) => db.insert(reviewLogs).values({ userId: user.id, cardId, rating, reviewedAt: nsk(at) });
  await log(1, "good", "2026-10-05T10:00"); // bank — знаком с прошлой недели и раньше
  await log(1, "good", "2026-10-08T10:00");
  await log(1, "good", "2026-10-12T10:00");
  await log(2, "again", "2026-10-13T10:00"); // snag — новый на этой неделе, забывался
  await log(2, "again", "2026-10-14T10:00");
  await log(2, "good", "2026-10-15T10:00");
  await log(3, "good", "2026-10-18T21:00"); // уже следующая неделя
  await db.insert(mistakes).values({ userId: user.id, category: "артикли", wrong: "a", right: "the", createdAt: nsk("2026-10-01T10:00"), resolvedAt: nsk("2026-10-16T10:00") });
  return { db, user };
}

describe("📬 personal week", () => {
  it("sums up the week that just ended", async () => {
    const { db, user } = await setup();
    const report = await weeklyReport(db, (await getUser(db, user.id))!, nsk("2026-10-18T20:30"));
    expect(report).toMatchObject({
      reviews: 4,
      reviewsBefore: 2,
      accuracy: 50,
      started: 1,
      hardest: [{ term: "snag", forgot: 2 }],
      resolvedTopics: ["артикли"],
    });
    const text = weeklyReportText(report);
    expect(text).toContain("📈 +2 к прошлой");
    expect(text).toContain("<b>snag</b> ×2");
  });

  it("is sent once on Sunday evening, only to those who want it and were active", async () => {
    const { db, user } = await setup();
    expect(await collectWeeklyReports(db, nsk("2026-10-18T19:00"))).toEqual([]);
    expect((await collectWeeklyReports(db, nsk("2026-10-18T20:30"))).map((r) => r.user.id)).toEqual([user.id]);
    expect(await collectWeeklyReports(db, nsk("2026-10-18T21:00"))).toEqual([]);

    const quiet = await setup();
    await updateUser(quiet.db, quiet.user.id, { weeklyReport: false });
    expect(await collectWeeklyReports(quiet.db, nsk("2026-10-18T20:30"))).toEqual([]);
    void cards;
  });
});
