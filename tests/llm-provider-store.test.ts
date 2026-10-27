import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { initialProvider, readProvider, writeProvider } from "../src/llm/provider-store";

const fresh = () => join(mkdtempSync(join(tmpdir(), "llm-provider-")), "llm-provider");

describe("provider-store", () => {
  it("returns nothing when the choice was never made", () => {
    expect(readProvider(fresh())).toBeUndefined();
  });

  it("remembers the choice and reads it back", () => {
    const path = fresh();
    expect(writeProvider(path, "openrouter")).toBe(true);
    expect(readProvider(path)).toBe("openrouter");
    // Файл читает человек — перевод строки в конце, без мусора.
    expect(readFileSync(path, "utf8")).toBe("openrouter\n");
  });

  it("ignores a file with an unknown provider instead of trusting it", () => {
    const path = fresh();
    writeFileSync(path, "gpt-5\n");
    expect(readProvider(path)).toBeUndefined();
  });

  it("prefers the saved choice over the variable in .env", () => {
    const path = fresh();
    writeProvider(path, "openrouter");
    expect(initialProvider(path, "claude-code")).toBe("openrouter");
  });

  it("falls back to the variable in .env when there is no saved choice", () => {
    expect(initialProvider(fresh(), "openrouter")).toBe("openrouter");
  });

  it("creates the data directory when it does not exist yet", () => {
    const path = join(mkdtempSync(join(tmpdir(), "llm-provider-")), "data", "nested", "llm-provider");
    expect(writeProvider(path, "claude-code")).toBe(true);
    expect(readProvider(path)).toBe("claude-code");
  });

  it("does not throw when the choice cannot be saved", () => {
    // Выбор уже применён в памяти: не суметь записать его — не повод ронять бота.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    // Каталог вместо файла — запись не пройдёт.
    const dir = mkdtempSync(join(tmpdir(), "llm-provider-"));
    expect(writeProvider(dir, "openrouter")).toBe(false);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
