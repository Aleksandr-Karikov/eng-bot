import type { Db } from "./db/client";
import type { User } from "./db/schema";
import { updateUser } from "./services/users";

export type SendOptions = Record<string, unknown>;

export interface SendApi {
  sendMessage(chatId: number, text: string, other?: SendOptions): Promise<unknown>;
}

function errorCode(err: unknown): unknown {
  return typeof err === "object" && err !== null && "error_code" in err
    ? (err as { error_code: unknown }).error_code
    : undefined;
}

export class Notifier {
  constructor(
    private readonly api: SendApi,
    private readonly db: Db,
  ) {}

  async dm(user: User, text: string, other?: SendOptions): Promise<boolean> {
    if (!user.canDm) return false;
    try {
      await this.api.sendMessage(user.telegramId, text, other);
      return true;
    } catch (err) {
      if (errorCode(err) === 403) {
        await updateUser(this.db, user.id, { canDm: false });
      } else {
        console.error("DM failed", user.telegramId, err);
      }
      return false;
    }
  }

  async group(chatId: number, text: string, other?: SendOptions): Promise<boolean> {
    try {
      await this.api.sendMessage(chatId, text, other);
      return true;
    } catch (err) {
      console.error("Group send failed", chatId, err);
      return false;
    }
  }
}
