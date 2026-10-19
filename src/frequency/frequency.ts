import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Частотность слов по шкале Zipf: 1 — редкое, 7 — самое частое (the ≈ 7.7). */
export interface FrequencySource {
  zipf(terms: string[]): Promise<Map<string, number>>;
}

/** wordfreq (Python): объединяет субтитры, новости, Википедию, соцсети — то, что люди реально читают и слышат. */
export class WordfreqSource implements FrequencySource {
  private readonly python: string;
  private readonly script: string;

  constructor(python: string, script: string) {
    this.python = resolve(python);
    this.script = resolve(script);
  }

  async zipf(terms: string[]): Promise<Map<string, number>> {
    if (terms.length === 0) return new Map();
    // Слова — одним JSON-аргументом, без shell.
    const { stdout } = await run(this.python, ["-I", this.script, JSON.stringify(terms)], { timeout: 30_000 });
    return new Map(Object.entries(JSON.parse(stdout) as Record<string, number>));
  }
}
