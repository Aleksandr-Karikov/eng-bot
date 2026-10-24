# Распознавание речи

Голосовые в /talk (Whisper large-v3-turbo через mlx) и эксперимент с произношением /pron
(модель фонем wav2vec2-lv-60-espeak-cv-ft, эталон — espeak). Локально, без интернета после первой загрузки.

    cd tools/stt
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python mlx-whisper==0.4.3 soundfile==0.14.0 transformers==5.20.2 torch==2.14.1 phonemizer-fork==3.3.2 espeakng-loader==0.2.4

Первый запуск скачивает модели (~2 ГБ). Бот запускает `stt_server.py` сам, если есть `.venv`;
без него голосовые не распознаются. Записи из /pron с результатами — в `data/voice-samples/`.
