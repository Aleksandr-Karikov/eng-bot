import { describe, expect, it, vi } from "vitest";
import { startMeetingPollLoop } from "../src/bot/meeting-poll-loop";
import { getMeetingPoll } from "../src/services/meeting-polls";
import { botHarness } from "./bot-harness";

const CHAT = -100123;
const COMMAND = "/meetpoll 12:00 Asia/Novosibirsk | 18:00 | 19:30 | Не смогу";

describe("ежедневный опрос о встрече", () => {
  it("принимает настройки только от владельца и отклоняет неверное расписание и варианты", async () => {
    const h = botHarness({ chatOwnerId: 1 });
    await h.bot.handleUpdate(h.groupMessage(2, CHAT, COMMAND));
    expect(await getMeetingPoll(h.db, CHAT)).toBeUndefined();
    for (const input of [
      "/meetpoll 25:00 | 18:00 | Не смогу",
      "/meetpoll 12:00 Invalid/Zone | 18:00 | Не смогу",
      "/meetpoll 12:00 | 18:00 | 18:00",
    ]) {
      await h.bot.handleUpdate(h.groupMessage(1, CHAT, input));
      expect(await getMeetingPoll(h.db, CHAT)).toBeUndefined();
    }
    await h.bot.handleUpdate(h.groupMessage(1, CHAT, COMMAND));
    await h.bot.handleUpdate(h.groupMessage(2, CHAT, "/meetpoll off"));
    expect(await getMeetingPoll(h.db, CHAT)).toMatchObject({
      time: "12:00", timezone: "Asia/Novosibirsk", options: ["18:00", "19:30", "Не смогу"],
    });
  });

  it("публикует открытый опрос с множественным выбором и сохраняет отметку при перезапуске и перенастройке", async () => {
    vi.useFakeTimers();
    const h = botHarness({ chatOwnerId: 1 });
    await h.bot.handleUpdate(h.groupMessage(1, CHAT, COMMAND));
    h.setNow(new Date("2026-11-19T04:59:00Z"));
    let stop = startMeetingPollLoop(h.db, h.deps.now, h.bot.api);
    const polls = () => h.calls.filter(({ method }) => method === "sendPoll");
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(polls()).toHaveLength(0);

      h.setNow(new Date("2026-11-19T05:00:00Z"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(polls().map(({ payload }) => payload)).toEqual([{
        chat_id: CHAT,
        question: "Сможешь сегодня встретиться? Отметь все удобные варианты. (19.11.2026)",
        options: [{ text: "18:00" }, { text: "19:30" }, { text: "Не смогу" }],
        is_anonymous: false,
        allows_multiple_answers: true,
      }]);

      stop();
      await h.bot.handleUpdate(h.groupMessage(1, CHAT, "/meetpoll off"));
      await h.bot.handleUpdate(h.groupMessage(1, CHAT, COMMAND.replace("19:30", "20:00")));
      stop = startMeetingPollLoop(h.db, h.deps.now, h.bot.api);
      await vi.advanceTimersByTimeAsync(0);
      expect(polls()).toHaveLength(1);

      h.setNow(new Date("2026-11-20T05:01:00Z"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(polls()).toHaveLength(2);
      expect(polls()[1].payload.options).toContainEqual({ text: "20:00" });

      await h.bot.handleUpdate(h.groupMessage(1, CHAT, "/meetpoll off"));
      h.setNow(new Date("2026-11-21T05:00:00Z"));
      await vi.advanceTimersByTimeAsync(60_000);
      expect(polls()).toHaveLength(2);
    } finally {
      stop();
      vi.useRealTimers();
    }
  });
});
