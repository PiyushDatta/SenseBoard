#!/usr/bin/env python3
import os
import sys
from pathlib import Path

import requests


def load_dotenv(dotenv_path: Path) -> None:
    """
    Minimal .env loader:
    - supports KEY=VALUE
    - ignores blank lines and comments starting with #
    - strips optional surrounding quotes on VALUE
    - does NOT override already-set environment variables
    """
    if not dotenv_path.exists():
        raise FileNotFoundError(f"Missing .env file at: {dotenv_path}")

    for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        # Strip surrounding quotes
        if len(value) >= 2 and ((value[0] == value[-1] == '"') or (value[0] == value[-1] == "'")):
            value = value[1:-1]

        if key and key not in os.environ:
            os.environ[key] = value


def main() -> int:
    dotenv_path = Path.cwd() / ".env"
    try:
        load_dotenv(dotenv_path)
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        print("Tip: run this from the folder that contains your .env", file=sys.stderr)
        return 2

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("OPENAI_API_KEY not found in environment or .env", file=sys.stderr)
        return 2

    url = "https://api.openai.com/v1/models"
    headers = {"Authorization": f"Bearer {api_key}"}

    try:
        r = requests.get(url, headers=headers, timeout=30)
    except requests.RequestException as e:
        print(f"Network error calling {url}: {e}", file=sys.stderr)
        return 1

    if r.status_code != 200:
        print(f"Error {r.status_code} from OpenAI:", file=sys.stderr)
        print(r.text, file=sys.stderr)
        return 1

    data = r.json().get("data", [])
    ids = sorted(m.get("id", "") for m in data if m.get("id"))
    for mid in ids:
        print(mid)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())