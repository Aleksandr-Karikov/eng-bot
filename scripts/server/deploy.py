"""Pull main after GitHub CI succeeds, then restart the bot."""

import json
import subprocess
import time
from urllib.request import Request, urlopen


REPO = "/opt/eng-bot-git"
URL = "https://github.com/Aleksandr-Karikov/eng-bot.git"


def run(*args, cwd=REPO):
    subprocess.run(args, cwd=cwd, check=True)


latest = subprocess.check_output(["git", "ls-remote", URL, "refs/heads/main"], text=True).split()[0]
current = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO, text=True).strip()
if latest == current:
    raise SystemExit(0)

request = Request(
    f"https://api.github.com/repos/Aleksandr-Karikov/eng-bot/commits/{latest}/check-runs",
    headers={"Accept": "application/vnd.github+json", "User-Agent": "eng-bot-deploy"},
)
with urlopen(request, timeout=15) as response:
    checks = json.load(response)["check_runs"]
if not any(c["name"] == "checks" and c["conclusion"] == "success" for c in checks):
    print(f"CI not passed for {latest[:12]}")
    raise SystemExit(0)

run("git", "pull", "--ff-only", "origin", "main")
run("npm", "ci", "--no-audit", "--no-fund")
run("npm", "ci", "--no-audit", "--no-fund", cwd=f"{REPO}/app")
run("npm", "run", "build", cwd=f"{REPO}/app")
run("sudo", "-n", "systemctl", "restart", "eng-bot.service")
for attempt in range(15):
    try:
        with urlopen("http://127.0.0.1:8788/app/", timeout=2) as response:
            if response.status == 200:
                break
    except OSError:
        time.sleep(1)
else:
    raise RuntimeError("Mini App did not become healthy")
print(f"deployed {latest[:12]}")
