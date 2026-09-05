#!/usr/bin/env python3
"""Download all Hugging Face models used by the VaakSetu local AI service.

Examples:
  python scripts/download-models.py
  python scripts/download-models.py --cache-dir E:\vaaksetu-model-cache
  python scripts/download-models.py --model whisper --model nllb

The cache can be copied to another machine at the same path, or selected with
HF_HOME/HUGGINGFACE_HUB_CACHE before starting the local AI service.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Iterable

MODEL_GROUPS = {
    "indictrans": [
        "ai4bharat/indictrans2-en-indic-dist-200M",
        "ai4bharat/indictrans2-en-indic-1B",
        "ai4bharat/indictrans2-indic-en-dist-200M",
        "ai4bharat/indictrans2-indic-en-1B",
        "ai4bharat/indictrans2-indic-indic-dist-320M",
        "ai4bharat/indictrans2-indic-indic-1B",
    ],
    "nllb": [
        "facebook/nllb-200-distilled-600M",
    ],
    "whisper": [
        "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
        "Systran/faster-whisper-medium",
        "Systran/faster-whisper-small",
    ],
}

MODEL_REQUIRED_FILES = {
    "indictrans": {"config.json", "tokenizer_config.json"},
    "nllb": {"config.json", "tokenizer_config.json"},
    "whisper": {"config.json", "model.bin"},
}
MODEL_WEIGHT_PREFIXES = {
    "indictrans": ("model.safetensors", "pytorch_model.bin"),
    "nllb": ("model.safetensors", "pytorch_model.bin"),
    "whisper": ("model.bin",),
}


def validate_snapshot(snapshot_path: str, model_id: str) -> None:
    """Reject metadata-only or otherwise incomplete model snapshots."""
    snapshot = Path(snapshot_path)
    files = {path.name for path in snapshot.rglob("*") if path.is_file()}
    group = next(group for group, models in MODEL_GROUPS.items() if model_id in models)
    missing = MODEL_REQUIRED_FILES[group] - files
    has_weights = any(
        name == prefix or name.startswith(f"{prefix}-")
        for name in files
        for prefix in MODEL_WEIGHT_PREFIXES[group]
    )
    if not has_weights:
        missing.add("model weights")
    if missing:
        raise RuntimeError(
            f"incomplete snapshot; missing required files: {', '.join(sorted(missing))}"
        )


def default_cache_dir() -> Path:
    """Return the Hugging Face hub cache used by transformers and faster-whisper."""
    configured = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if configured:
        return Path(configured).expanduser()

    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        return Path(hf_home).expanduser() / "hub"

    return Path.home() / ".cache" / "huggingface" / "hub"


def iter_model_ids(groups: Iterable[str]) -> list[str]:
    model_ids: list[str] = []
    for group in groups:
        for model_id in MODEL_GROUPS[group]:
            if model_id not in model_ids:
                model_ids.append(model_id)
    return model_ids


def download_models(model_ids: Iterable[str], cache_dir: Path, token: str | None) -> int:
    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        print(
            "[ERROR] huggingface_hub is not installed. Run "
            "python -m pip install huggingface-hub.",
            file=sys.stderr,
        )
        return 1

    cache_dir.mkdir(parents=True, exist_ok=True)
    print(f"[INFO] Hugging Face cache: {cache_dir}")
    print("[INFO] Downloading model snapshots. Existing files are reused.")

    failed = False
    for model_id in model_ids:
        print(f"\n[START] {model_id}")
        try:
            snapshot_path = snapshot_download(
                repo_id=model_id,
                cache_dir=str(cache_dir),
                token=token or None,
                resume_download=True,
            )
            validate_snapshot(snapshot_path, model_id)
            print(f"[OK]    {snapshot_path}")
        except Exception as error:
            failed = True
            print(f"[FAILED] {model_id}: {error}", file=sys.stderr)
            print(
                "        Check the repository name, internet connection, and HF_TOKEN "
                "if the model is gated.",
                file=sys.stderr,
            )

    if failed:
        print("\n[RESULT] Some models failed. Rerun the command to resume.", file=sys.stderr)
        return 1

    print("\n[RESULT] All requested models are available in the Hugging Face cache.")
    print("[NOTE] Edge TTS and gTTS are network services; this script cannot cache their voices.")
    return 0


def main() -> int:
    try:
        from dotenv import load_dotenv

        load_dotenv()
    except ImportError:
        pass

    parser = argparse.ArgumentParser(
        description="Download VaakSetu translation and transcription models."
    )
    parser.add_argument(
        "--model",
        dest="groups",
        action="append",
        choices=sorted(MODEL_GROUPS),
        help="Download only this group. Repeat for multiple groups. Default: all groups.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=None,
        help="Hugging Face hub cache directory. Default: HF_HOME/hub or ~/.cache/huggingface/hub.",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN"),
        help="Hugging Face token. Prefer setting HF_TOKEN instead of putting it in shell history.",
    )
    args = parser.parse_args()

    groups = args.groups or list(MODEL_GROUPS)
    model_ids = iter_model_ids(groups)
    cache_dir = (args.cache_dir or default_cache_dir()).expanduser().resolve()

    print(f"[INFO] Groups: {', '.join(groups)}")
    print(f"[INFO] Models: {len(model_ids)}")
    return download_models(model_ids, cache_dir, args.token)


if __name__ == "__main__":
    raise SystemExit(main())
