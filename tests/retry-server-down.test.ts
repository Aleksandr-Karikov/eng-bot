import { describe, expect, it, vi } from "vitest";
import { RETRY_DELAY_MS, retryServerDown } from "../app/src/retry";

/**
 * Повтор запроса при 502 (E36). На VPS бот падал от нехватки памяти, systemd поднимал его через
 * несколько секунд, а всё, что приложение отправило в этот промежуток, получало 502 и терялось:
 * человек видел «Ответ не сохранён», карточка оставалась неоценённой (#24). Один повтор закрывает
 * этот промежуток — и ровно один, чтобы лежащий сервер не превратился в бесконечную очередь.
 */

/** Ошибка с HTTP-кодом — так клиент (`ApiError`) сообщает, что ответил сервер. */
class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const noSleep = () => Promise.resolve();

describe("retryServerDown", () => {
  it("повторяет запрос после 502 и возвращает результат второй попытки", async () => {
    let calls = 0;
    const run = vi.fn(async () => {
      calls++;
      if (calls === 1) throw new HttpError("Bad Gateway", 502);
      return "ответ";
    });
    await expect(retryServerDown(run, { sleep: noSleep })).resolves.toBe("ответ");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("повторяет и на 503 с 504 — это те же «сервер не ответил»", async () => {
    for (const status of [503, 504]) {
      let calls = 0;
      const run = async () => {
        calls++;
        if (calls === 1) throw new HttpError("down", status);
        return status;
      };
      await expect(retryServerDown(run, { sleep: noSleep })).resolves.toBe(status);
      expect(calls, `код ${status}`).toBe(2);
    }
  });

  it("делает ровно одну повторную попытку: третий отказ уходит наверх", async () => {
    const run = vi.fn(async () => {
      throw new HttpError("Bad Gateway", 502);
    });
    await expect(retryServerDown(run, { sleep: noSleep })).rejects.toThrow("Bad Gateway");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("не повторяет ошибку, которую сервер вернул осознанно", async () => {
    const cases = [400, 401, 404, 409, 429];
    for (const status of cases) {
      const run = vi.fn(async () => {
        throw new HttpError("нет", status);
      });
      await expect(retryServerDown(run, { sleep: noSleep }), `код ${status}`).rejects.toThrow("нет");
      expect(run, `код ${status}`).toHaveBeenCalledTimes(1);
    }
  });

  it("не повторяет ошибку без кода: сеть оборвалась до ответа сервера", async () => {
    const run = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(retryServerDown(run, { sleep: noSleep })).rejects.toThrow("Failed to fetch");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ждёт перед повтором столько, сколько сказано", async () => {
    const sleep = vi.fn(async () => {});
    let calls = 0;
    const run = async () => {
      calls++;
      if (calls === 1) throw new HttpError("Bad Gateway", 502);
      return "ok";
    };
    await retryServerDown(run, { sleep });
    expect(sleep).toHaveBeenCalledWith(RETRY_DELAY_MS);
  });

  it("первый успешный запрос не ждёт и не повторяется", async () => {
    const sleep = vi.fn(async () => {});
    const run = vi.fn(async () => "ok");
    await expect(retryServerDown(run, { sleep })).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
