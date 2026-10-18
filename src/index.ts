import { API_CONSTANTS, Bot } from "grammy";
import { setupBot, COMMANDS } from "./bot/setup";
import type { BotContext } from "./bot/context";
import { BatchStore } from "./bot/batches";
import { DraftStore } from "./bot/drafts";
import { DuelStore } from "./bot/duels";
import { DrillStore } from "./bot/drills";
import { EditStore } from "./bot/edits";
import { ExerciseStore } from "./bot/exercises";
import { ChatHistory } from "./bot/history";
import { PendingMistakesStore } from "./bot/pending-mistakes";
import { PickerStore } from "./bot/pickers";
import { PictureWishStore } from "./bot/picture-wishes";
import { PracticeStore } from "./bot/practice";
import { RoomNameStore } from "./bot/room-names";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { ClaudeCodeEnricher } from "./llm/claude-code";
import { Notifier } from "./notifier";
import { ClozeGenerator } from "./services/cloze-generator";
import { FluxSynth, ImageService } from "./images/images";
import { BackgroundPainter, onAcPower } from "./images/painter";
import { PictureStore } from "./images/store";
import { MnemonicGenerator } from "./services/hard-words";
import { MacSaySynth } from "./speech/tts";
import { VoiceStore } from "./bot/voices";
import { existsSync } from "node:fs";
import { TranscriptSubtitles } from "./youtube/subtitles";
import { TalkStore } from "./bot/talks";
import { CollocationGenerator } from "./services/collocations";
import { startReminderLoop } from "./reminder-loop";
import type { Deps } from "./bot/context";
import { publishStory } from "./bot/handlers/story";

try {
  process.loadEnvFile(".env");
} catch {
  // .env необязателен — переменные можно передать окружением.
}

const config = loadConfig();
const db = createDb(config.dbPath);
const bot = new Bot<BotContext>(config.botToken);
const notifier = new Notifier(
  { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as Parameters<typeof bot.api.sendMessage>[2]) },
  db,
);
const now = () => new Date();

const claude = new ClaudeCodeEnricher({ model: config.enrichModel, timeoutMs: config.enrichTimeoutMs, mnemonicModel: config.mnemonicModel });
const images = config.mfluxBin ? new ImageService(new FluxSynth(config.mfluxBin), claude, config.imageStyle) : undefined;
const pictures = images ? new PictureStore("data/images") : undefined;
const mnemonicGen = new MnemonicGenerator(db, claude);

await bot.init();
const deps: Deps = {
  db,
  notifier,
  now,
  enricher: claude,
  tutor: claude,
  clozeGen: new ClozeGenerator(db, claude, now),
  collocationGen: new CollocationGenerator(db, claude),
  mnemonicGen,
  drafts: new DraftStore(),
  batches: new BatchStore(),
  pickers: new PickerStore(),
  edits: new EditStore(),
  history: new ChatHistory(),
  exercises: new ExerciseStore(),
  drills: new DrillStore(),
  speech: new MacSaySynth(),
  voices: new VoiceStore(),
  roomNames: new RoomNameStore(),
  duels: new DuelStore(),
  pendingMistakes: new PendingMistakesStore(),
  random: Math.random,
  practice: new PracticeStore(),
  pictureWishes: new PictureWishStore(),
  talks: new TalkStore(),
  youtube: existsSync(config.youtubePython) ? new TranscriptSubtitles(config.youtubePython, "tools/youtube/transcript.py") : undefined,
  images,
  pictures,
  botUsername: bot.botInfo.username,
};
setupBot(bot, deps);
await bot.api.setMyCommands(COMMANDS);

const stopReminders = startReminderLoop({
  db,
  notifier,
  now,
  story: async (room) => room.telegramChatId != null && publishStory(bot.api, deps, room.telegramChatId, room),
});
const stopPainter =
  images && pictures && config.imagesBackground
    ? new BackgroundPainter({ db, images, pictures, onPower: onAcPower }).start()
    : () => {};

const shutdown = () => {
  stopReminders();
  stopPainter();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`@${bot.botInfo.username} started`);
// message_reaction не входит в обновления по умолчанию — без него 👀 для /check не придёт.
await bot.start({ allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, "message_reaction"] });
