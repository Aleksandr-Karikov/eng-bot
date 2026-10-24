import { describe, expect, it } from "vitest";
import { rooms, words } from "../src/db/schema";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { decide, listSets, nextSetItems, replaceSet, undoDecision } from "../src/services/word-sets";
import { botHarness } from "./bot-harness";
import { sign } from "@telegram-apps/init-data-node";
import { createApp } from "../src/app/server";

const TOKEN = "123:test-token";
import { T0, makeUser } from "./helpers";

const item = (term: string) => ({ term, translation: term + "-ru", explanation: "", example: "", transcriptionUk: "", transcriptionUs: "", usefulness: 3, usefulnessNote: "" });

async function setup() {
  const h = botHarness();
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  // Учит с друзьями в общей комнате, где уже есть «bank».
  const shared = await createRoom(h.db, { name: "Друзья", createdBy: user.id, now: T0 });
  await saveWord(h.db, { roomId: shared.id, addedBy: user.id, draft: { term: "bank", translation: "берег", explanation: "", example: "" }, now: T0 });
  await replaceSet(h.db, { slug: "b1", title: "B1", kind: "level", description: "", position: 1 }, [item("bank"), item("river"), item("tree"), item("river")], T0);
  return { h, user, shared };
}

describe("📦 word sets", () => {
  it("skips duplicates and words already being learned, counts them as done", async () => {
    const { h, user } = await setup();
    const [summary] = await listSets(h.db, user.id);
    expect(summary).toMatchObject({ total: 3, done: 1 });
    expect((await nextSetItems(h.db, user.id, summary.set.id)).map((i) => i.term)).toEqual(["river", "tree"]);
  });

  it("«учу» goes to the personal dictionary, not the shared room; «знаю» just counts; both can be undone", async () => {
    const { h, user, shared } = await setup();
    const [river, tree] = await nextSetItems(h.db, user.id, (await listSets(h.db, user.id))[0].set.id);
    expect(await decide(h.db, { userId: user.id, itemId: river.id, decision: "learn", now: T0 })).toBe(true);
    expect(await decide(h.db, { userId: user.id, itemId: river.id, decision: "learn", now: T0 })).toBe(false);
    await decide(h.db, { userId: user.id, itemId: tree.id, decision: "know", now: T0 });

    const added = (await h.db.select().from(words)).find((w) => w.term === "river")!;
    const [personal] = (await h.db.select().from(rooms)).filter((r) => r.personalOf === user.id);
    expect(added.roomId).toBe(personal.id);
    expect(added.roomId).not.toBe(shared.id);
    expect((await listSets(h.db, user.id))[0]).toMatchObject({ total: 3, done: 3 });

    await undoDecision(h.db, { userId: user.id, itemId: river.id });
    expect((await h.db.select().from(words)).map((w) => w.term)).toEqual(["bank"]);
    expect((await listSets(h.db, user.id))[0].done).toBe(2);
  });

  it("the app lists sets with progress, deals the next words and takes decisions", async () => {
    const { h } = await setup();
    const app = createApp({ deps: h.deps, botToken: TOKEN });
    const headers = { authorization: `tma ${sign({ user: { id: 100, first_name: "U" } }, TOKEN, new Date())}`, "content-type": "application/json" };
    const { sets } = await (await app.request("/api/sets", { headers })).json();
    expect(sets).toMatchObject([{ title: "B1", total: 3, done: 1 }]);
    const { items } = await (await app.request(`/api/sets/${sets[0].id}`, { headers })).json();
    expect(items.map((i: { term: string }) => i.term)).toEqual(["river", "tree"]);
    const post = (body: object) => app.request("/api/sets/decide", { method: "POST", headers, body: JSON.stringify(body) });
    expect((await post({ itemId: items[0].id, decision: "learn" })).status).toBe(200);
    expect((await post({ itemId: items[0].id, decision: "learn" })).status).toBe(409);
    expect((await post({ itemId: items[0].id, undo: true })).status).toBe(200);
    expect((await app.request(`/api/audio?item=${items[1].id}&accent=uk`, { headers })).status).toBe(200);
  });
});
