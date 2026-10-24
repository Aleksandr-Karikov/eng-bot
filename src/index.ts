import { API_CONSTANTS, Bot } from "grammy";
import { redactLogs } from "./log-redact";
import { captureRecentLogs } from "./log-buffer";
import { ChatTranscript } from "./bot/transcript";
import { setupBot, COMMANDS, GROUP_COMMANDS } from "./bot/setup";
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
import { KokoroSynth, MacSaySynth } from "./speech/tts";
import { VoiceStore } from "./bot/voices";
import { existsSync } from "node:fs";
import type { Server } from "node:http";
import { TranscriptSubtitles } from "./youtube/subtitles";
import { dbExercisePersistence } from "./services/pending-exercises";
import { startCaptureServer } from "./capture/server";
import { startAppServer } from "./app/server";
import { WordfreqSource } from "./frequency/frequency";
import { TranslateStore } from "./bot/translations";
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
redactLogs(config.botToken);
captureRecentLogs();
const db = createDb(config.dbPath);
const bot = new Bot<BotContext>(config.botToken);
const notifier = new Notifier(
  { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as Parameters<typeof bot.api.sendMessage>[2]) },
  db,
);
const now = () => new Date();

// Озвучка: нейросетевые голоса Kokoro, если поставлены (tools/tts), иначе встроенный голос macOS.
const speech = existsSync(config.ttsPython) ? new KokoroSynth(config.ttsPython, "tools/tts/kokoro_server.py", new MacSaySynth()) : new MacSaySynth();
const claude = new ClaudeCodeEnricher({
  model: config.enrichModel,
  timeoutMs: config.enrichTimeoutMs,
  mnemonicModel: config.mnemonicModel,
  checkModel: config.checkModel,
});
const images = config.mfluxBin ? new ImageService(new FluxSynth(config.mfluxBin), claude, config.imageStyle) : undefined;
const pictures = images ? new PictureStore("data/images") : undefined;
const mnemonicGen = new MnemonicGenerator(db, claude);

const exercises = new ExerciseStore(dbExercisePersistence(db));
await exercises.load();
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
  exercises,
  drills: new DrillStore(),
  speech,
  voices: new VoiceStore(),
  roomNames: new RoomNameStore(),
  duels: new DuelStore(),
  pendingMistakes: new PendingMistakesStore(),
  random: Math.random,
  practice: new PracticeStore(),
  pictureWishes: new PictureWishStore(),
  talks: new TalkStore(),
  translations: new TranslateStore(),
  transcript: new ChatTranscript(),
  frequency: existsSync(config.wordfreqPython) ? new WordfreqSource(config.wordfreqPython, "tools/wordfreq/zipf.py") : undefined,
  youtube: existsSync(config.youtubePython) ? new TranscriptSubtitles(config.youtubePython, "tools/youtube/transcript.py") : undefined,
  images,
  pictures,
  botUsername: bot.botInfo.username,
};
let captureServer: Server | undefined;
if (config.capturePort) {
  deps.capturePort = config.capturePort;
  captureServer = startCaptureServer(deps, config.capturePort);
}
if (config.appPort) startAppServer({ deps, api: bot.api, botToken: config.botToken }, config.appPort);
deps.appUrl = config.appUrl;
setupBot(bot, deps);
await bot.api.setMyCommands(COMMANDS, { scope: { type: "all_private_chats" } });
await bot.api.setMyCommands(GROUP_COMMANDS, { scope: { type: "all_group_chats" } });
// Прежнее общее меню (scope по умолчанию) — тоже на короткое, чтобы не всплывало старое длинное.
await bot.api.setMyCommands(COMMANDS);
// Кнопка у поля ввода в личке: открывает Mini App с карточками (если задан APP_URL), иначе — обычное меню команд.
await bot.api
  .setChatMenuButton({ menu_button: config.appUrl ? { type: "web_app", text: "📚 Учить", web_app: { url: config.appUrl } } : { type: "commands" } })
  .catch((err) => console.error("Menu button failed", err));

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
  if (speech instanceof KokoroSynth) speech.close();
  captureServer?.close();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`@${bot.botInfo.username} started`);
// message_reaction не входит в обновления по умолчанию — без него 👀 для /check не придёт.
await bot.start({ allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, "message_reaction"] });
