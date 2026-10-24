# Озвучка Kokoro

Нейросетевые голоса для 🔊, диктанта и историй (Kokoro-82M, локально, без интернета).

    cd tools/tts
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python kokoro==0.9.4 soundfile==0.13.1

Первый запуск скачивает модель (~330 МБ). Бот запускает `kokoro_server.py` сам, если есть `.venv`;
без него — встроенный голос macOS (`say`).
