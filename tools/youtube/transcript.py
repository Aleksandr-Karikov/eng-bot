"""Расшифровка видео YouTube: python transcript.py <video_id> [язык: en | ko] → JSON {"text": "..."} или {"error": "..."}."""
import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api._errors import (
    IpBlocked,
    NoTranscriptFound,
    RequestBlocked,
    TranscriptsDisabled,
    VideoUnavailable,
)


def main() -> None:
    video_id = sys.argv[1]
    lang = sys.argv[2] if len(sys.argv) > 2 else "en"
    languages = ["en", "en-US", "en-GB"] if lang == "en" else [lang]
    try:
        # Ручные субтитры важнее автоматических — библиотека выбирает их первыми.
        parts = YouTubeTranscriptApi().fetch(video_id, languages=languages)
        print(json.dumps({"text": " ".join(p.text for p in parts)}, ensure_ascii=False))
    except (NoTranscriptFound, TranscriptsDisabled):
        print(json.dumps({"error": "no_transcript"}))
    except VideoUnavailable:
        print(json.dumps({"error": "unavailable"}))
    except (RequestBlocked, IpBlocked):
        print(json.dumps({"error": "blocked"}))


main()
