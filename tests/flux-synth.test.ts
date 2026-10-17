import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FluxSynth } from "../src/images/images";

let dir = "";
afterEach(async () => dir && rm(dir, { recursive: true, force: true }));

describe("FluxSynth", () => {
  it("runs a generator given by a path relative to the bot's directory and returns the PNG it wrote", async () => {
    dir = await mkdtemp(join(tmpdir(), "fake-mflux-"));
    const fake = join(dir, "mflux-generate");
    // Поддельный mflux: пишет в --output текст промпта.
    await writeFile(fake, '#!/bin/sh\nwhile [ "$1" ]; do case "$1" in --prompt) p="$2";; --output) o="$2";; esac; shift; done\nprintf "%s" "$p" > "$o"\n');
    await chmod(fake, 0o755);
    const png = await new FluxSynth(relative(process.cwd(), fake)).draw("devils besieging a man");
    expect(png.toString()).toBe("devils besieging a man");
  });
});
