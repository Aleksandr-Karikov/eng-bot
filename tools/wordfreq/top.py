"""Самые частые английские слова по порядку: python top.py 25000 → ["the", "of", ...]."""
import json
import sys

from wordfreq import top_n_list

print(json.dumps(top_n_list("en", int(sys.argv[1]))))
