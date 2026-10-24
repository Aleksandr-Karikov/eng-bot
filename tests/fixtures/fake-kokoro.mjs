// Подделка tools/tts/kokoro_server.py для тестов: пишет короткий тихий WAV; текст «fail» — ошибка, «crash» — падение.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

function silentWav(seconds = 0.1, rate = 24000) {
  const samples = Math.floor(seconds * rate);
  const b = Buffer.alloc(44 + samples * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + samples * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(samples * 2, 40);
  return b;
}

console.log(JSON.stringify({ ready: true }));
createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (req.text === "crash") process.exit(3);
  if (req.text === "fail") return console.log(JSON.stringify({ id: req.id, ok: false, error: "nothing to say" }));
  writeFileSync(req.out, silentWav());
  console.log(JSON.stringify({ id: req.id, ok: true }));
});
