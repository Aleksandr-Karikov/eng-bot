"""Частотность слов по шкале Zipf (1 — редкое, 7 — самое частое): python zipf.py '["flood", "melt"]' [en | ko] → {"flood": 4.34, ...}.
Для корейского нужен MeCab: pip install mecab-python3 mecab-ko-dic."""
import json
import sys

from wordfreq import zipf_frequency

terms = json.loads(sys.argv[1])
lang = sys.argv[2] if len(sys.argv) > 2 else "en"
print(json.dumps({t: zipf_frequency(t, lang) for t in terms}))
