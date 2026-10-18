import { describe, expect, it, vi } from "vitest";
import type { ExtractedItem, WordEnricher } from "../src/llm/enricher";
import { createRoom } from "../src/services/rooms";
import { updateUser } from "../src/services/users";
import { findYoutubeUrl, youtubeVideoId, YoutubeBlockedError, type SubtitleSource } from "../src/youtube/subtitles";
import { botHarness, lastButtons } from "./bot-harness";
import { T0, makeUser } from "./helpers";

describe("YouTube subtitles", () => {
  it("finds video links of every shape", () => {
    expect(findYoutubeUrl("look https://youtu.be/arj7oStGLkU?t=3 lol")).toBe("https://youtu.be/arj7oStGLkU?t=3");
    expect(findYoutubeUrl("https://www.youtube.com/watch?v=arj7oStGLkU&list=x")).toBe("https://www.youtube.com/watch?v=arj7oStGLkU&list=x");
    expect(findYoutubeUrl("https://youtube.com/shorts/abcdefghijk")).toBe("https://youtube.com/shorts/abcdefghijk");
    expect(findYoutubeUrl("https://example.com/watch?v=abc")).toBeUndefined();
  });

  it("takes the video id out of any link", () => {
    expect(youtubeVideoId("https://youtu.be/arj7oStGLkU?t=3")).toBe("arj7oStGLkU");
    expect(youtubeVideoId("https://www.youtube.com/watch?list=x&v=arj7oStGLkU")).toBe("arj7oStGLkU");
    expect(youtubeVideoId("https://youtube.com/shorts/abcdefghijk")).toBe("abcdefghijk");
  });
});

describe("🎬 a link in the bot", () => {
  async function setup(source: SubtitleSource) {
    const extract = vi.fn(async (_text: string): Promise<ExtractedItem[]> => [{ term: "impasse", translation: "тупик", explanation: "", example: "", context: "" }]);
    const enricher: WordEnricher = {
      enrich: async () => ({ translation: "t", explanation: "", example: "" }),
      extract,
      extractImage: async () => [],
      check: async () => ({ corrected: "", fixes: [], natural: "" }),
    };
    const h = botHarness({ enricher, youtube: source });
    const user = await updateUser(h.db, (await makeUser(h.db, 100)).id, { canDm: true });
    await createRoom(h.db, { name: "R", createdBy: user.id, now: T0 });
    return { h, extract };
  }
  const sent = (h: ReturnType<typeof botHarness>) => h.calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));

  it("a link sent in a DM is read through its subtitles, not added as a word", async () => {
    const fetch = vi.fn(async () => ({ title: "Negotiation tips", text: "we've reached an impasse" }));
    const { h, extract } = await setup({ fetch });
    await h.bot.handleUpdate(h.message(100, "https://youtu.be/arj7oStGLkU"));
    await vi.waitFor(() => expect(lastButtons(h.calls).some((b) => b.text.includes("impasse"))).toBe(true));
    expect(fetch).toHaveBeenCalledWith("https://youtu.be/arj7oStGLkU");
    expect(extract).toHaveBeenCalledWith("we've reached an impasse");
    expect(sent(h).some((t) => t.includes("«Negotiation tips»"))).toBe(true);
  });

  it("explains when YouTube blocks the bot or there are no subtitles", async () => {
    const blocked = await setup({ fetch: async () => Promise.reject(new YoutubeBlockedError("Sign in")) });
    await blocked.h.bot.handleUpdate(blocked.h.message(100, "/text https://youtu.be/arj7oStGLkU"));
    await vi.waitFor(() => expect(sent(blocked.h).some((t) => t.includes("не отдаёт субтитры"))).toBe(true));

    const none = await setup({ fetch: async () => undefined });
    await none.h.bot.handleUpdate(none.h.message(100, "https://youtu.be/arj7oStGLkU"));
    await vi.waitFor(() => expect(sent(none.h).some((t) => t.includes("нет английских субтитров"))).toBe(true));
  });
});
