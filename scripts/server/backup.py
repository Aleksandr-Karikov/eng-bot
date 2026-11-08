"""Back up the live SQLite database without losing WAL contents."""

from datetime import datetime
from pathlib import Path
import sqlite3


root = Path(__file__).resolve().parents[2] / "data"
backups = root / "backups"
backups.mkdir(exist_ok=True)
target = backups / f"eng-bot-{datetime.now():%Y%m%d-%H%M%S}.sqlite"

with sqlite3.connect(root / "eng-bot.sqlite") as source, sqlite3.connect(target) as copy:
    source.backup(copy)
    assert copy.execute("PRAGMA integrity_check").fetchone()[0] == "ok"

for old in sorted(backups.glob("eng-bot-*.sqlite"), reverse=True)[14:]:
    old.unlink()

print(f"backup ok: {target}")
