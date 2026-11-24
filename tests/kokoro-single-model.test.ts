import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const SCRIPT = "tools/tts/kokoro_server.py";

/**
 * Одна модель Kokoro на оба акцента (E36).
 *
 * Раньше `kokoro_server.py` создавал `KPipeline` на каждый акцент, и каждый тянул свою копию весов:
 * на VPS с 4 ГБ это 1714 МБ, процесс убивался OOM-killer'ом, вместе с ним падал бот, и ответы людей
 * терялись с 502. Теперь модель загружается один раз (`KModel`) и передаётся обвязке каждого акцента.
 *
 * Проверка читает скрипт, а не запускает модель: запуск — это ~1.2 ГБ памяти и 12 секунд, а гейт
 * должен оставаться быстрым и не зависеть от того, скачаны ли веса. Настоящий прогон с обоими
 * акцентами и замером памяти записан в журнале E36.
 */
describe("Kokoro: одна модель на оба акцента", () => {
  it("KPipeline создаётся один раз на акцент и получает общую модель параметром", async () => {
    const src = await readFile(SCRIPT, "utf8");
    // Модель загружается отдельно от обвязки — иначе каждая обвязка тянула бы свои веса.
    expect(src).toContain("KModel(");
    const pipelines = src.match(/KPipeline\([^)]*\)/g) ?? [];
    // Один вызов в comprehension, обслуживающий оба акцента из VOICES.
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]).toMatch(/model\s*=\s*model/);
  });

  it("акцентов по-прежнему два, и у каждого свой голос", async () => {
    const src = await readFile(SCRIPT, "utf8");
    expect(src).toMatch(/VOICES\s*=\s*\{[^}]*"uk"[^}]*\}/);
    expect(src).toMatch(/VOICES\s*=\s*\{[^}]*"us"[^}]*\}/);
    expect(src).toContain("bm_george");
    expect(src).toContain("af_heart");
  });

  it("протокол обмена не изменился: ready, id, ok — по строке на запрос", async () => {
    const src = await readFile(SCRIPT, "utf8");
    // Бот (`src/speech/worker.ts`) ждёт именно этих полей: сломав их, получим молчание на все фразы.
    expect(src).toContain('"ready": True');
    expect(src).toContain('"id": req.get("id")');
    expect(src).toContain('"ok": True');
    expect(src).toContain('"ok": False');
  });
});
