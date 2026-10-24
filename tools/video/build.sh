#!/bin/sh
# Приветственное видео для /start → assets/welcome.mp4. Голос: VOICE=xenia (по умолчанию) | baya | kseniya | aidar | eugene.
set -eu
cd "$(dirname "$0")/../.."
OUT=tools/video/out
mkdir -p "$OUT" assets
PY=${TTS_PYTHON:-tools/tts/.venv/bin/python}

"$PY" tools/video/narrate.py "$OUT" "${VOICE:-xenia}"
node tools/video/record.mjs "$PWD/$OUT"

# Реплики с паузами точно под тайминг сцен (LEAD и TAIL — как в scenes.html).
"$PY" - "$OUT" <<'PYEOF'
import json, subprocess, sys
out = sys.argv[1]
LEAD, TAIL = 0.45, 0.75
parts = []
for s in json.load(open(f"{out}/timeline.json")):
    pad = f"{out}/pad-{s['id']}.wav"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", f"{out}/say-{s['id']}.wav", "-af", f"adelay={int(LEAD * 1000)}:all=1,apad=whole_dur={LEAD + s['dur'] + TAIL}", "-ar", "48000", "-ac", "1", pad], check=True)
    parts.append(f"file '{pad.split('/')[-1]}'")
open(f"{out}/list.txt", "w").write("\n".join(parts))
PYEOF
ffmpeg -y -loglevel error -f concat -safe 0 -i "$OUT/list.txt" -af "loudnorm=I=-16:TP=-1.5" -ar 48000 "$OUT/voice.wav"

DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/frames.mp4")
"$PY" tools/video/music.py "$DUR" "$OUT/music.wav"
# Музыка тихо фоном и ещё тише, пока говорит диктор.
ffmpeg -y -loglevel error -i "$OUT/frames.mp4" -i "$OUT/voice.wav" -i "$OUT/music.wav" -filter_complex \
  "[2:a]volume=-21dB[m];[1:a]asplit=2[v][key];[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=40:release=500[duck];[v][duck]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" \
  -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k -shortest -movflags +faststart assets/welcome.mp4
echo "assets/welcome.mp4 — $(du -h assets/welcome.mp4 | cut -f1)"
