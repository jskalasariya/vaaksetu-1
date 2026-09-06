#!/usr/bin/env python3
"""
VaakSetu Local AI Service — Cross-Platform Launcher
====================================================
Works on macOS, Linux, and Windows 11 without any path configuration.
Automatically discovers the virtual environment, validates dependencies,
and starts the FastAPI service.

Usage:
  python scripts/start-local-ai.py
  python scripts/start-local-ai.py --port 8001
  python scripts/start-local-ai.py --venv /path/to/venv
"""

import sys
import os
import subprocess
import argparse
from pathlib import Path

# ── Directories ───────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SERVICE_FILE = ROOT_DIR / "mini-services" / "local_ai_service.py"


def find_python(explicit_venv: Path | None = None) -> Path:
    """
    Discover the Python interpreter to use, in priority order:
    1. VAAKSETU_PYTHON environment variable
    2. Explicitly passed --venv argument
    3. venv / .venv adjacent to root or one level up (platform-aware path)
    4. Conda environment named 'vaaksetu'
    5. The current interpreter (sys.executable)
    """

    # Determine the platform-specific Scripts sub-directory
    scripts = "Scripts" if sys.platform == "win32" else "bin"
    exe = "python.exe" if sys.platform == "win32" else "python"

    # 1. Explicit env var
    env_python = os.environ.get("VAAKSETU_PYTHON")
    if env_python:
        p = Path(env_python)
        if p.is_file():
            return p

    # 2. --venv argument
    if explicit_venv:
        candidate = explicit_venv / scripts / exe
        if candidate.is_file():
            return candidate

    # 3. venv / .venv in root or parent
    for base in [ROOT_DIR, ROOT_DIR.parent]:
        for venv_name in ["venv", ".venv"]:
            candidate = base / venv_name / scripts / exe
            if candidate.is_file():
                return candidate

    # 4. Conda 'vaaksetu' environment
    try:
        result = subprocess.run(
            ["conda", "info", "--base"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            conda_base = Path(result.stdout.strip())
            conda_python = conda_base / "envs" / "vaaksetu" / scripts / exe
            if conda_python.is_file():
                return conda_python
    except (FileNotFoundError, subprocess.TimeoutExpired):
        pass

    # 5. Current interpreter fallback
    return Path(sys.executable)


def check_dependencies(python: Path) -> bool:
    """Check that critical Python packages are installed."""
    required = ["fastapi", "torch", "faster_whisper", "uvicorn", "pydub", "pyttsx3", "piper"]
    result = subprocess.run(
        [str(python), "-c", f"import {', '.join(required)}; print('ok')"],
        capture_output=True,
        text=True,
    )
    return result.returncode == 0 and result.stdout.strip() == "ok"


def main():
    parser = argparse.ArgumentParser(
        description="VaakSetu Local AI Service cross-platform launcher"
    )
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    parser.add_argument("--venv", type=Path, default=None, help="Path to virtual environment")
    args = parser.parse_args()

    print("=" * 58)
    print("  VaakSetu Local AI Engine v3.0")
    print(f"  Platform: {sys.platform}")
    print(f"  Root:     {ROOT_DIR}")
    print("=" * 58)

    # ── Find Python ────────────────────────────────────────────
    python = find_python(args.venv)
    print(f"[OK] Using Python: {python}")

    try:
        ver = subprocess.check_output(
            [str(python), "--version"], text=True
        ).strip()
        print(f"     {ver}")
    except Exception:
        pass

    compute = subprocess.run(
        [
            str(python),
            "-c",
            "import torch; print('cuda_available=' + str(torch.cuda.is_available()).lower()); print('cuda_version=' + str(torch.version.cuda)); print('gpu=' + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'))",
        ],
        capture_output=True,
        text=True,
    )
    if compute.returncode == 0:
        for line in compute.stdout.strip().splitlines():
            print(f"[Compute] {line}")

    # ── Validate service file ──────────────────────────────────
    if not SERVICE_FILE.is_file():
        print(f"[ERROR] Service file not found: {SERVICE_FILE}")
        sys.exit(1)

    # ── Check dependencies ─────────────────────────────────────
    print("[Check] Validating dependencies...")
    if not check_dependencies(python):
        req_file = ROOT_DIR / "mini-services" / "requirements.txt"
        print(f"[WARN] Some packages are missing. Install them with:")
        print(f"       {python} -m pip install -r {req_file}")

    # ── Launch ────────────────────────────────────────────────
    env = os.environ.copy()
    env["LOCAL_AI_PORT"] = str(args.port)
    env["HUGGINGFACE_HUB_CACHE"] = env.get(
        "HUGGINGFACE_HUB_CACHE",
        str(Path.home() / ".cache" / "huggingface" / "hub"),
    )
    env["HF_HOME"] = str(Path(env["HUGGINGFACE_HUB_CACHE"]).parent)
    env["HF_HUB_OFFLINE"] = "1"
    env["TRANSFORMERS_OFFLINE"] = "1"
    env["HF_DATASETS_OFFLINE"] = "1"
    print(f"[Offline] Hugging Face cache: {env['HUGGINGFACE_HUB_CACHE']}")

    print(f"[Start] Launching on http://127.0.0.1:{args.port} ...")
    os.chdir(ROOT_DIR)

    # subprocess is used on every platform so the offline environment is
    # passed explicitly; os.execv would inherit the parent environment only.
    proc = subprocess.run(
        [str(python), str(SERVICE_FILE)],
        env=env,
        cwd=ROOT_DIR,
    )
    sys.exit(proc.returncode)


if __name__ == "__main__":
    main()
