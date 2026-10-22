import { describe, expect, it, vi } from "vitest";
import type { Enrichment } from "../src/llm/enricher";
import { buildPrompt, parseEnrichment } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { saveWord } from "../src/services/words";
import { botHarness, settle } from "./bot-harness";
import { T0, makeUser } from "./helpers";

const tooth: Enrichment = { term: "tooth", translation: "зуб", explanation: "Твёрдая часть во рту.", example: "I lost a tooth.", transcriptionUk: "/tuːθ/", transcriptionUs: "/tuθ/" };

async function setup(enrich: (term: string, hint?: string) => Promise<Enrichment>) {
  const h = botHarness({ enricher: { enrich: vi.fn(enrich), extract: async () => [], extractImage: async () => [], check: async () => ({ corrected: "", fixes: [], natural: "" }) } });
  const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
  const room = await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
  return { h, user, room };
}

const lastText = (h: ReturnType<typeof botHarness>) => String(h.calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text);

describe("/add with a Russian word", () => {
  it("asks for the English equivalent and drafts «tooth — зуб», not «зуб — зуб»", async () => {
    const { h } = await setup(async () => tooth);
    await h.bot.handleUpdate(h.message(100, "/add зуб"));
    await settle(50);
    expect(h.deps.enricher.enrich).toHaveBeenCalledWith("зуб", undefined);
    expect(lastText(h)).toContain("<b>tooth</b> — зуб");
  });

  it("«/add зуб — tooth» is read the other way round", async () => {
    const { h } = await setup(async () => ({ ...tooth, term: undefined }));
    await h.bot.handleUpdate(h.message(100, "/add зуб — tooth"));
    await settle(50);
    expect(h.deps.enricher.enrich).toHaveBeenCalledWith("tooth", "зуб");
    expect(lastText(h)).toContain("<b>tooth</b> — зуб");
  });

  it("says so when the English word is already in the room", async () => {
    const { h, user, room } = await setup(async () => tooth);
    await saveWord(h.db, { roomId: room.id, addedBy: user.id, draft: { term: "tooth", translation: "зуб", explanation: "", example: "" }, now: T0 });
    await h.bot.handleUpdate(h.message(100, "/add зуб"));
    await settle(50);
    expect(lastText(h)).toContain("«tooth» уже есть в комнате");
  });

  it("the prompt asks for the English equivalent and its term comes back", () => {
    expect(buildPrompt("зуб")).toContain("Русское слово или фраза");
    expect(buildPrompt("tooth")).toContain("Английское слово или фраза");
    expect(parseEnrichment('{"term": "tooth", "translation": "зуб"}').term).toBe("tooth");
  });
});
