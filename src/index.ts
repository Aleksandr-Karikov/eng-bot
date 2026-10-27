import { autoRetry } from "@grammyjs/auto-retry";
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
import { OpenRouterBackend } from "./llm/openrouter";
import { ProviderRouter } from "./llm/provider";
import { initialProvider, writeProvider } from "./llm/provider-store";
import { Notifier } from "./notifier";
import { ClozeGenerator } from "./services/cloze-generator";
import { ApiSynth, FluxSynth, ImageService, type ImageSynth } from "./images/images";
import { BackgroundPainter, onAcPower } from "./images/painter";
import { PictureStore } from "./images/store";
import { MnemonicGenerator } from "./services/hard-words";
import { KokoroSynth, LanguageAwareSynth, MacSaySynth } from "./speech/tts";
import { LocalRecognizer } from "./speech/stt";
import { wordLanguage } from "./services/words";
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
// Ключ OpenRouter — второй секрет в логах: тела ошибок провайдера пишутся как есть.
if (config.openRouterKey) redactLogs(config.openRouterKey, "<OPEN_ROUTER_API_KEY>");
// Ключ рисовалки — третий секрет (инвариант 7): у него может быть отдельный баланс и лимит.
if (config.imageApiKey) redactLogs(config.imageApiKey, "<IMAGE_API_KEY>");
captureRecentLogs();
const db = createDb(config.dbPath);
const bot = new Bot<BotContext>(config.botToken);
// Telegram ограничивает частоту (в группе — около 20 сообщений и правок в минуту) и отвечает 429 «подожди N секунд»:
// ждём и повторяем, иначе шаг (например, разбор слов по одному) обрывался на полпути.
bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));
const notifier = new Notifier(
  { sendMessage: (chatId, text, other) => bot.api.sendMessage(chatId, text, other as Parameters<typeof bot.api.sendMessage>[2]) },
  db,
);
const now = () => new Date();

// Озвучка: нейросетевые голоса Kokoro, если поставлены (tools/tts), иначе встроенный голос macOS.
const englishSpeech = existsSync(config.ttsPython) ? new KokoroSynth(config.ttsPython, "tools/tts/kokoro_server.py", new MacSaySynth()) : new MacSaySynth();
// Другие языки — голосом macOS языка (lang.ts).
const speech = new LanguageAwareSynth(englishSpeech);
// Прогрев: модель Kokoro грузится секунды — пусть это случится при старте, а не на первом 🔊.
void englishSpeech.synthesize("hello", "uk").catch(() => {});
// Голосовые: Whisper и модель фонем, если поставлены (tools/stt).
const recognizer = existsSync(config.sttPython) ? new LocalRecognizer(config.sttPython, "tools/stt/stt_server.py") : undefined;
// LLM: по умолчанию локальный Claude Code; OpenRouter — если заданы ключ и модель.
// Провайдера можно менять на лету (/llm в боте или scripts/llm.ts), перезапуск не нужен.
const llm = new ProviderRouter({
  models: {
    claudeCode: { main: config.enrichModel, mnemonic: config.mnemonicModel, check: config.checkModel },
    openrouter: {
      main: config.openRouterModel ?? "",
      mnemonic: config.openRouterMnemonicModel ?? "",
      check: config.openRouterCheckModel ?? "",
    },
  },
  timeoutMs: config.enrichTimeoutMs,
  provider: initialProvider(config.llmProviderFile, config.llmProvider),
  ...(config.openRouterKey
    ? { openRouter: new OpenRouterBackend({ apiKey: config.openRouterKey, title: "WordBoss" }) }
    : {}),
});
// Куда сохранять выбор из бота: .env правит только CLI, бот пишет отдельный файл (см. provider-store).
llm.onSwitch = (provider) => writeProvider(config.llmProviderFile, provider);
// Ключ без имени модели бесполезен: переключение в OpenRouter такую настройку не пропустит.
if (config.openRouterKey && !config.openRouterModel) {
  console.warn("OPEN_ROUTER_API_KEY задан, а OPENROUTER_MODEL нет — OpenRouter не включится (см. .env.example).");
}
console.log(`LLM: ${llm.provider}${llm.openRouterReady ? " (OpenRouter доступен)" : ""}`);
// Рисовалка: внешний API, если задан ключ (нужен на Linux), иначе локальный FLUX через MLX.
const imageSynth: ImageSynth | undefined = config.imageApiKey && config.imageModel
  ? new ApiSynth({ apiKey: config.imageApiKey, model: config.imageModel, title: "WordBoss" })
  : config.mfluxBin
    ? new FluxSynth(config.mfluxBin)
    : undefined;
if (config.imageApiKey && config.mfluxBin) {
  console.warn("Заданы и IMAGE_API_KEY, и MFLUX_BIN — картинки рисует API (IMAGE_API_KEY важнее).");
}
console.log(imageSynth ? `Картинки: ${imageSynth instanceof ApiSynth ? `API ${config.imageModel}` : "локальный FLUX"}` : "Картинки: выключены");
const images = imageSynth ? new ImageService(imageSynth, llm, config.imageStyle, (wordId) => wordLanguage(db, wordId)) : undefined;
const pictures = images ? new PictureStore("data/images") : undefined;
const mnemonicGen = new MnemonicGenerator(db, llm);

const exercises = new ExerciseStore(dbExercisePersistence(db));
await exercises.load();
await bot.init();
const deps: Deps = {
  db,
  notifier,
  now,
  enricher: llm,
  tutor: llm,
  clozeGen: new ClozeGenerator(db, llm, now),
  collocationGen: new CollocationGenerator(db, llm),
  mnemonicGen,
  drafts: new DraftStore(),
  batches: new BatchStore(),
  pickers: new PickerStore(),
  edits: new EditStore(),
  history: new ChatHistory(),
  exercises,
  drills: new DrillStore(),
  speech,
  recognizer,
  voiceSamplesDir: "data/voice-samples",
  welcomeVideo: existsSync("assets/welcome.mp4") ? "assets/welcome.mp4" : undefined,
  adminTelegramId: config.adminTelegramId,
  voices: new VoiceStore(),
  roomNames: new RoomNameStore(),
  duels: new DuelStore(),
  pendingMistakes: new PendingMistakesStore(),
  random: Math.random,
  llm,
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
  if (englishSpeech instanceof KokoroSynth) englishSpeech.close();
  recognizer?.close();
  captureServer?.close();
  void bot.stop();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

console.log(`@${bot.botInfo.username} started`);
// message_reaction не входит в обновления по умолчанию — без него 👀 для /check не придёт.
await bot.start({ allowed_updates: [...API_CONSTANTS.DEFAULT_UPDATE_TYPES, "message_reaction"] });
