"""
Распознавание речи для бота: постоянный процесс, чтобы модели грузились один раз.
Читает со stdin строки JSON, пишет на stdout по строке на запрос:
  {"id", "op": "transcribe", "wav"}                    → {"id", "ok": true, "text"}
  {"id", "op": "phonemes", "wav", "text", "accent", "refs"} → {"id", "ok": true, "heard", "expected", "score", "diff", "accent"}
wav — 16 кГц моно. Whisper — что услышал «слушатель» (он додумывает слова, поэтому для произношения
отдельно модель фонем: она пишет звуки, какие были). Эталоны — из espeak тем же алфавитом и то, что та же
модель слышит у диктора (refs: [{"accent", "wav"}]): так её собственные привычки не засчитываются как ошибка.
"""
import difflib
import json
import os
import re
import sys

import espeakng_loader
import mlx_whisper
import soundfile as sf

WHISPER = "mlx-community/whisper-large-v3-turbo"
PHONEME_MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"

os.environ.setdefault("ESPEAK_DATA_PATH", espeakng_loader.get_data_path())
from phonemizer.backend.espeak.wrapper import EspeakWrapper  # noqa: E402

EspeakWrapper.set_library(espeakng_loader.get_library_path())
from phonemizer import phonemize  # noqa: E402
from phonemizer.separator import Separator  # noqa: E402

_phonemes = None


def phoneme_model():
    """Модель фонем грузится при первой проверке произношения — для одних голосовых /talk она не нужна."""
    global _phonemes
    if _phonemes is None:
        import torch
        from transformers import Wav2Vec2ForCTC, Wav2Vec2Processor

        _phonemes = (Wav2Vec2Processor.from_pretrained(PHONEME_MODEL), Wav2Vec2ForCTC.from_pretrained(PHONEME_MODEL).eval(), torch)
    return _phonemes


def load(path):
    audio, rate = sf.read(path, dtype="float32")
    if rate != 16000:
        raise ValueError(f"expected 16 kHz, got {rate}")
    return audio


def transcribe(req):
    result = mlx_whisper.transcribe(load(req["wav"]), path_or_hf_repo=WHISPER, language="en", condition_on_previous_text=False)
    return {"text": result["text"].strip()}


def heard_phonemes(audio):
    processor, model, torch = phoneme_model()
    inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
    with torch.no_grad():
        ids = model(inputs.input_values).logits.argmax(dim=-1)
    return processor.batch_decode(ids)[0].split()


def expected_phonemes(text, accent):
    lang = "en-gb" if accent == "uk" else "en-us"
    ipa = phonemize(text, language=lang, backend="espeak", separator=Separator(phone=" ", word=" | "), strip=True, with_stress=False)
    return [p for p in ipa.split() if p != "|"]


# Модель многоязычная: пишет одно и то же разными значками (придыхание, тоны, длина, тёмное l) — сводим к одному.
VOWELS = {
    **dict.fromkeys("ɑ ɒ ɔ a ä".split(), "ɑ"),
    **dict.fromkeys("ə ɐ ɚ ɜ ʌ ᵻ ɘ".split(), "ə"),
    **dict.fromkeys("e ɛ e̞".split(), "ɛ"),
    **dict.fromkeys("oʊ əʊ o".split(), "oʊ"),
    **dict.fromkeys("ɪə iə ɪɹ".split(), "ɪə"),
    **dict.fromkeys("eə ɛə ɛɹ".split(), "eə"),
    **dict.fromkeys("ʊə ʊɹ".split(), "ʊə"),
}
CONSONANTS = {"ph": "p", "th": "t", "kh": "k", "ɫ": "l", "l̩": "l", "əl": "ə l", "n̩": "n", "ɾ": "t", "r": "ɹ", "ɻ": "ɹ", "ʔ": "", "dZ": "dʒ", "tS": "tʃ"}


def normalize(phones):
    out = []
    for p in phones:
        p = re.sub(r"[0-9ʰʲː:.^\[]", "", p)
        if len(p) > 1:
            p = p.rstrip("ɜ")  # тон 3 в словаре модели
        p = VOWELS.get(CONSONANTS.get(p, p), CONSONANTS.get(p, p))
        for q in p.split():
            # Придыхание отдельным значком после p / t / k.
            if not (q == "h" and out and out[-1] in ("p", "t", "k")):
                out.append(q)
    return out


def compare(expected, heard):
    matcher = difflib.SequenceMatcher(a=expected, b=heard, autojunk=False)
    diff = [{"op": op, "expected": expected[i1:i2], "heard": heard[j1:j2]} for op, i1, i2, j1, j2 in matcher.get_opcodes()]
    return {"heard": heard, "expected": expected, "score": round(matcher.ratio(), 3), "diff": diff}


def phonemes(req):
    """accent uk / us — эталоны этого акцента; any — оба, засчитывается ближайший (не придираемся к UK/US)."""
    heard = normalize(heard_phonemes(load(req["wav"])))
    accents = ["uk", "us"] if req.get("accent") == "any" else [req.get("accent", "us")]
    refs = [(a, normalize(expected_phonemes(req["text"], a))) for a in accents]
    refs += [(r["accent"], normalize(heard_phonemes(load(r["wav"])))) for r in req.get("refs", []) if r["accent"] in accents]
    results = [{**compare(expected, heard), "accent": a} for a, expected in refs if expected]
    return max(results, key=lambda r: r["score"])


OPS = {"transcribe": transcribe, "phonemes": phonemes}

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    req = {}
    try:
        req = json.loads(line)
        print(json.dumps({"id": req.get("id"), "ok": True, **OPS[req["op"]](req)}, ensure_ascii=False), flush=True)
    except Exception as err:  # noqa: BLE001 — сбой одного запроса не должен ронять процесс
        print(json.dumps({"id": req.get("id"), "ok": False, "error": str(err)}), flush=True)
