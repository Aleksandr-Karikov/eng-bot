"""
Озвучка сцен приветственного видео голосом Silero (русский, локально): script.json → say-<id>.wav и timeline.json с длительностями.
  python narrate.py <out dir> [голос: xenia | baya | kseniya | aidar | eugene]
"""
import json
import os
import sys

import soundfile as sf
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
out_dir = sys.argv[1]
speaker = sys.argv[2] if len(sys.argv) > 2 else "xenia"
model = torch.package.PackageImporter(os.path.join(HERE, "v4_ru.pt")).load_pickle("tts_models", "model")
timeline = []
for scene in json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8")):
    audio = model.apply_tts(text=scene["say"], speaker=speaker, sample_rate=48000, put_accent=True, put_yo=True).numpy()
    sf.write(os.path.join(out_dir, f"say-{scene['id']}.wav"), audio, 48000)
    timeline.append({**scene, "dur": round(len(audio) / 48000, 3)})
json.dump(timeline, open(os.path.join(out_dir, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
