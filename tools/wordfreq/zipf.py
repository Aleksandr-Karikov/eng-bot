"""Частотность английских слов по шкале Zipf (1 — редкое, 7 — самое частое): python zipf.py '["flood", "melt"]' → {"flood": 4.34, ...}."""
import json
import sys

from wordfreq import zipf_frequency

terms = json.loads(sys.argv[1])
print(json.dumps({t: zipf_frequency(t, "en") for t in terms}))
