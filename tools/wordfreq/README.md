# Частотность слов (wordfreq)

Насколько слово полезно учить: `wordfreq` даёт частотность по шкале Zipf (1 — редкое, 7 — самое частое).
Бот показывает её при отборе слов, `scripts/rate-usefulness.ts` проставляет оценку уже добавленным.

Для корейского частотность считается по словарной форме, поэтому нужен токенизатор MeCab с корейским
словарём — отсюда `mecab-python3` и `mecab-ko-dic` в зависимостях. Для английского они не требуются,
но ставятся вместе.

    cd tools/wordfreq
    uv venv --python 3.12 .venv
    uv pip install --python .venv/bin/python -r requirements.txt

Бот запускает скрипты этим интерпретатором. Путь — `WORDFREQ_PYTHON`, по умолчанию
`tools/wordfreq/.venv/bin/python`; **если файла нет, оценка полезности просто выключается**, остальное
работает. Корейский без MeCab роняет только свой запрос — воркер не падает.

## Проверить вручную

```bash
tools/wordfreq/.venv/bin/python tools/wordfreq/zipf.py '["flood", "melt"]'      # → {"flood": 4.34, …}
tools/wordfreq/.venv/bin/python tools/wordfreq/zipf.py '["홍수"]' ko
tools/wordfreq/.venv/bin/python tools/wordfreq/top.py 25000                     # первые 25 000 английских слов
```

`zipf.py` принимает JSON-массив слов и код языка (`en` по умолчанию), `top.py` — сколько слов вернуть.
Оба печатают JSON в stdout: бот читает именно его.
