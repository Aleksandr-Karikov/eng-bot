"""Английская расшифровка видео YouTube: python transcript.py <video_id> → JSON {"text": "..."} или {"error": "..."}."""
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
    try:
        # Ручные субтитры важнее автоматических — библиотека выбирает их первыми.
        parts = YouTubeTranscriptApi().fetch(video_id, languages=["en", "en-US", "en-GB"])
        print(json.dumps({"text": " ".join(p.text for p in parts)}, ensure_ascii=False))
    except (NoTranscriptFound, TranscriptsDisabled):
        print(json.dumps({"error": "no_transcript"}))
    except VideoUnavailable:
        print(json.dumps({"error": "unavailable"}))
    except (RequestBlocked, IpBlocked):
        print(json.dumps({"error": "blocked"}))


main()
