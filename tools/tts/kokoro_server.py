"""
Озвучка Kokoro для бота: постоянный процесс, чтобы модель грузилась один раз.
Читает со stdin строки JSON {"id", "text", "accent": "uk"|"us", "out": путь к .wav},
пишет на stdout {"id", "ok": true} или {"id", "ok": false, "error"} — по строке на запрос.

Модель ОДНА на оба акцента (E36). Раньше здесь было два `KPipeline`, и каждый держал свою копию
весов: на VPS с 4 ГБ процесс занимал 1714 МБ и попадал под OOM-killer вместе с ботом. `KModel`
загружается один раз, а `KPipeline` получает её параметром — так обвязка на каждый язык своя
(свой фонемайзер), а веса общие. Замер: 1714 МБ → 1299 МБ, оба акцента озвучиваются.
"""
import json
import sys

import numpy as np
import soundfile as sf
from kokoro import KModel, KPipeline

VOICES = {"uk": ("b", "bm_george"), "us": ("a", "af_heart")}
model = KModel(repo_id="hexgrad/Kokoro-82M")
pipelines = {
    accent: KPipeline(lang_code=lang, repo_id="hexgrad/Kokoro-82M", model=model)
    for accent, (lang, _voice) in VOICES.items()
}

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
