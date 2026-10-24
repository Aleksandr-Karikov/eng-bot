# Приветственное видео для /start

Сцены — `scenes.html` (рисует любой момент через `window.render(t)`), текст озвучки — `script.json`,
голос — Silero (русский, локально), музыка — синтезируется `music.py`, без чужих треков.

    curl -L -o tools/video/v4_ru.pt https://models.silero.ai/models/tts/ru/v4_ru.pt   # один раз, 40 МБ
    tools/video/build.sh              # → assets/welcome.mp4 (около 2 минут)
    VOICE=aidar tools/video/build.sh  # другой голос: xenia, baya, kseniya, aidar, eugene

Python — из tools/tts/.venv (torch, soundfile, numpy), кадры пишет Chrome через puppeteer-core.
Превью кадров: `node tools/video/record.mjs "$PWD/tools/video/out" 3,12,24` → `still-<t>.jpg`
(после build.sh, нужен timeline.json). Бот подхватывает новый ролик после перезапуска.
