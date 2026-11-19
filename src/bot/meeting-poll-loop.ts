import type { Api } from "grammy";
import type { Db } from "../db/client";
import { sendMeetingPolls } from "../services/meeting-polls";

export function startMeetingPollLoop(db: Db, now: () => Date, api: Pick<Api, "sendPoll">): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await sendMeetingPolls(db, now(), (chatId, date, options) => {
        const displayDate = date.split("-").reverse().join(".");
        return api.sendPoll(chatId, `Сможешь сегодня встретиться? Если да, во сколько? (${displayDate})`, options, {
          is_anonymous: false,
        });
      });
    } catch (error) {
      console.error("Meeting poll tick failed", error);
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 60_000);
  return () => clearInterval(timer);
}
