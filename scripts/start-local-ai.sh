#!/usr/bin/env bash
# VaakSetu Local AI Service Launcher (macOS / Linux)
# Automatically discovers the virtual environment — no hardcoded paths.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=========================================================="
echo "  VaakSetu Local AI Engine v3.0"
echo "  Platform: $(uname -s)"
echo "  Root:     $ROOT_DIR"
echo "=========================================================="

# ── Find Python ────────────────────────────────────────────────
# Resolution order:
# 1. VAAKSETU_PYTHON env var (user-specified)
# 2. venv relative to root (./venv or ../venv)
# 3. .venv relative to root
# 4. conda env named 'vaaksetu'
# 5. system python3

find_python() {
  # 1. Explicit override
  if [ -n "${VAAKSETU_PYTHON:-}" ] && [ -x "$VAAKSETU_PYTHON" ]; then
    echo "$VAAKSETU_PYTHON"
    return 0
  fi

  # 2 & 3. venv / .venv adjacent to root or one level up
  for candidate in \
    "$ROOT_DIR/venv/bin/python" \
    "$ROOT_DIR/.venv/bin/python" \
    "$(dirname "$ROOT_DIR")/venv/bin/python" \
    "$(dirname "$ROOT_DIR")/.venv/bin/python"; do
    if [ -x "$candidate" ]; then
      echo "$candidate"
      return 0
    fi
  done

  # 4. Conda environment named 'vaaksetu'
  if command -v conda &>/dev/null; then
    local conda_env
    conda_env="$(conda info --base 2>/dev/null)/envs/vaaksetu/bin/python"
    if [ -x "$conda_env" ]; then
      echo "$conda_env"
      return 0
    fi
  fi

  # 5. System python3
  if command -v python3 &>/dev/null; then
    echo "$(command -v python3)"
    return 0
  fi

  echo ""
  return 1
}

PYTHON="$(find_python)"

if [ -z "$PYTHON" ]; then
  echo "[ERROR] Could not find a Python interpreter."
  echo "        Please set VAAKSETU_PYTHON to your venv python path, e.g.:"
  echo "        export VAAKSETU_PYTHON=/path/to/venv/bin/python"
  exit 1
fi

echo "[OK] Using Python: $PYTHON"
"$PYTHON" --version

export HUGGINGFACE_HUB_CACHE="${HUGGINGFACE_HUB_CACHE:-$HOME/.cache/huggingface/hub}"
export HF_HOME="$(dirname "$HUGGINGFACE_HUB_CACHE")"
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HF_DATASETS_OFFLINE=1
echo "[Offline] Hugging Face cache: $HUGGINGFACE_HUB_CACHE"

# ── Validate critical dependencies ────────────────────────────
echo "[Check] Validating dependencies..."
"$PYTHON" -c "import fastapi, torch, faster_whisper" 2>/dev/null || {
  echo "[WARN] Some dependencies may be missing. Run:"
  echo "       $PYTHON -m pip install -r $ROOT_DIR/mini-services/requirements.txt"
}

# ── Start Service ─────────────────────────────────────────────
export PYTORCH_ENABLE_MPS_FALLBACK=1
export LOCAL_AI_PORT="${LOCAL_AI_PORT:-8000}"
echo "[Start] Launching on http://127.0.0.1:$LOCAL_AI_PORT ..."

cd "$ROOT_DIR"
exec "$PYTHON" "$ROOT_DIR/mini-services/local_ai_service.py"
