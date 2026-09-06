#!/usr/bin/env python3
"""Download local Piper neural voices for offline VaakSetu TTS."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

VOICES = {
    "hi": "hi_IN-priyamvada-medium",
    "en": "en_US-lessac-medium",
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--language", choices=sorted(VOICES), default="hi")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "models" / "tts",
    )
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)
    voice = VOICES[args.language]
    command = [
        sys.executable,
        "-m",
        "piper.download_voices",
        "--download-dir",
        str(args.output_dir),
        voice,
    ]
    print(f"Downloading {voice} to {args.output_dir}")
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    raise SystemExit(main())
