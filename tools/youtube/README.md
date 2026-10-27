# Субтитры YouTube

Расшифровка видео по ссылке: если в сообщении боту есть ссылка на YouTube, он достаёт субтитры и
предлагает разобрать из них слова. Работает на `youtube-transcript-api` — скачивает уже готовые
субтитры (ручные важнее автоматических), без входа в аккаунт, токенов и `yt-dlp`.

    cd tools/youtube
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python -r requirements.txt

Бот запускает `transcript.py` этим интерпретатором. Путь — `YOUTUBE_PYTHON`, по умолчанию
`tools/youtube/.venv/bin/python`; **если файла нет, ссылки на YouTube просто не разбираются.**
Название видео берётся отдельно, через oEmbed, и в интерпретаторе не нуждается.

## Проверить вручную

```bash
tools/youtube/.venv/bin/python tools/youtube/transcript.py dQw4w9WgXcQ      # английский по умолчанию
tools/youtube/.venv/bin/python tools/youtube/transcript.py <video_id> ko
```

Печатает JSON: `{"text": "…"}` либо `{"error": "…"}`, где ошибка — `no_transcript`, `unavailable`
или `blocked` (YouTube закрыл доступ с этого IP; лечится сменой сети или ожиданием).
