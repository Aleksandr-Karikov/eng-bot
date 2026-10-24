"""
Озвучка Kokoro для бота: постоянный процесс, чтобы модель грузилась один раз.
Читает со stdin строки JSON {"id", "text", "accent": "uk"|"us", "out": путь к .wav},
пишет на stdout {"id", "ok": true} или {"id", "ok": false, "error"} — по строке на запрос.
"""
import json
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

VOICES = {"uk": ("b", "bm_george"), "us": ("a", "af_heart")}
pipelines = {accent: KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M") for accent, (lang, _) in VOICES.items()}

print(json.dumps({"ready": True}), flush=True)
for line in sys.stdin:
    req = {}
    try:
        req = json.loads(line)
        accent = req["accent"] if req.get("accent") in VOICES else "us"
        chunks = [c.audio.numpy() for c in pipelines[accent](req["text"], voice=VOICES[accent][1])]
        if not chunks:
            raise ValueError("nothing to say")
        sf.write(req["out"], np.concatenate(chunks), 24000)
        print(json.dumps({"id": req.get("id"), "ok": True}), flush=True)
    except Exception as err:  # noqa: BLE001 — любой сбой одной фразы не должен ронять процесс
        print(json.dumps({"id": req.get("id"), "ok": False, "error": str(err)}), flush=True)
