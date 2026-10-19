import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { cards, reviewLogs, words } from "../db/schema";
import { HARD_AFTER_LAPSES } from "../services/hard-words";
import type { ImageService } from "./images";
import type { PictureStore } from "./store";

const run = promisify(execFile);

/** Мак на зарядке? На батарее фоновая генерация (~12 ГБ памяти, нагрев) не запускается. */
export async function onAcPower(): Promise<boolean> {
  try {
    const { stdout } = await run("pmset", ["-g", "batt"], { timeout: 5_000 });
    return stdout.includes("AC Power");
  } catch {
    return true;
  }
}

export interface PainterDeps {
  db: Db;
  images: ImageService;
  pictures: PictureStore;
  onPower: () => Promise<boolean>;
}

/**
 * Рисует картинки заранее, пока никто не ждёт свою: по одной за проход, сначала трудные слова,
 * потом те, что раньше придут на повторение. Готовые лежат на диске до первой отправки.
 */
/** Упало рисование слова — повторить не раньше чем через сутки. */
const FAILED_RETRY_MS = 24 * 60 * 60_000;

export class BackgroundPainter {
  /** Слова, на которых рисование упало, — когда пробовать снова. */
  private readonly failedUntil = new Map<number, number>();
  private busy = false;

  constructor(private readonly deps: PainterDeps) {}

  /** Один проход: нарисовал — возвращает слово, иначе undefined (нечего, занято, на батарее). */
  async tick(): Promise<string | undefined> {
    if (this.busy || this.deps.images.queued > 0 || !(await this.deps.onPower())) return undefined;
    this.busy = true;
    try {
      const word = await this.nextWord();
      if (!word) return undefined;
      try {
        const png = await this.deps.images.drawWord(word);
        await this.deps.pictures.save(word, png);
      } catch (err) {
        // Не браться за это же слово каждую минуту: каждая попытка — загрузка модели на ~12 ГБ.
        this.failedUntil.set(word.id, Date.now() + FAILED_RETRY_MS);
        throw err;
      }
      return word.term;
    } finally {
      this.busy = false;
    }
  }

  private async nextWord() {
    const { db, pictures } = this.deps;
    const now = Date.now();
    const candidates = (await db.select().from(words).where(isNull(words.imageFileId))).filter(
      (w) => !pictures.find(w) && (this.failedUntil.get(w.id) ?? 0) <= now,
    );
    if (candidates.length === 0) return undefined;
    const due = await db.select({ wordId: cards.wordId, due: cards.due }).from(cards);
    const forgot = await db
      .select({ wordId: cards.wordId })
      .from(reviewLogs)
      .innerJoin(cards, eq(reviewLogs.cardId, cards.id))
      .where(eq(reviewLogs.rating, "again"));
    const forgotBy = (id: number) => forgot.filter((f) => f.wordId === id).length;
    const nextDue = (id: number) => Math.min(...due.filter((d) => d.wordId === id).map((d) => d.due.getTime()), Infinity);
    const hard = (id: number) => (forgotBy(id) >= HARD_AFTER_LAPSES ? 1 : 0);
    return candidates.sort((a, b) => hard(b.id) - hard(a.id) || nextDue(a.id) - nextDue(b.id) || a.id - b.id)[0];
  }

  start(intervalMs = 60_000): () => void {
    const tick = () =>
      this.tick()
        .then(async (term) => {
          if (term) console.log(`Background picture ready: ${term}`);
          await this.deps.pictures.prune(await this.deps.db.select().from(words));
        })
        .catch((err) => console.error("Background picture failed", err));
    const handle = setInterval(tick, intervalMs);
    return () => clearInterval(handle);
  }
}
