# VaakSetu Local AI Service Launcher — Windows PowerShell
# Automatically discovers the virtual environment. No hardcoded paths.
# Usage: .\scripts\start-local-ai.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir   = Split-Path -Parent $ScriptDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  VaakSetu Local AI Engine v3.0"
Write-Host "  Platform: Windows"
Write-Host "  Root:     $RootDir"
Write-Host "==========================================================" -ForegroundColor Cyan

# ── Find Python ────────────────────────────────────────────────
# Resolution order:
# 1. VAAKSETU_PYTHON env var (user-specified)
# 2. venv\Scripts\python.exe relative to root or parent
# 3. .venv\Scripts\python.exe
# 4. conda env named 'vaaksetu'
# 5. python from PATH

function Find-Python {
    # 1. Explicit override
    if ($env:VAAKSETU_PYTHON -and (Test-Path $env:VAAKSETU_PYTHON)) {
        return $env:VAAKSETU_PYTHON
    }

    # 2 & 3. venv / .venv in root or parent directory
    $candidates = @(
        (Join-Path $RootDir "venv\Scripts\python.exe"),
        (Join-Path $RootDir ".venv\Scripts\python.exe"),
        (Join-Path (Split-Path $RootDir) "venv\Scripts\python.exe"),
        (Join-Path (Split-Path $RootDir) ".venv\Scripts\python.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    # 4. Conda environment named 'vaaksetu'
    try {
        $condaBase = (conda info --base 2>$null).Trim()
        if ($condaBase) {
            $condaEnv = Join-Path $condaBase "envs\vaaksetu\python.exe"
            if (Test-Path $condaEnv) {
                return $condaEnv
            }
        }
    } catch {}

    # 5. System python
    $sysPython = Get-Command python -ErrorAction SilentlyContinue
    if ($sysPython) {
        return $sysPython.Source
    }

    return $null
}

$Python = Find-Python

if (-not $Python) {
    Write-Host "[ERROR] Could not find a Python interpreter." -ForegroundColor Red
    Write-Host "        Please set the VAAKSETU_PYTHON environment variable to your venv python.exe, e.g.:"
    Write-Host "        `$env:VAAKSETU_PYTHON = 'C:\path\to\venv\Scripts\python.exe'"
    exit 1
}

Write-Host "[OK] Using Python: $Python" -ForegroundColor Green
& $Python --version

# ── Report compute capability before starting ─────────────────
$compute = & $Python -c "import torch; print('cuda_available=' + str(torch.cuda.is_available()).lower()); print('cuda_version=' + str(torch.version.cuda)); print('gpu=' + (torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'none'))"
$compute | ForEach-Object { Write-Host "[Compute] $_" -ForegroundColor Cyan }

# ── Validate critical dependencies ────────────────────────────
Write-Host "[Check] Validating dependencies..." -ForegroundColor Yellow
$depsOk = & $Python -c "import fastapi, torch, faster_whisper, pyttsx3, piper; print('ok')" 2>$null
if ($depsOk -ne "ok") {
    Write-Host "[WARN] Some dependencies may be missing. Run:" -ForegroundColor Yellow
    Write-Host "       $Python -m pip install -r $RootDir\mini-services\requirements.txt"
}

# Force local model loading for every service process started by this script.
if (-not $env:HUGGINGFACE_HUB_CACHE) {
    $env:HUGGINGFACE_HUB_CACHE = Join-Path $env:USERPROFILE ".cache\huggingface\hub"
}
$env:HF_HOME = Split-Path $env:HUGGINGFACE_HUB_CACHE
$env:HF_HUB_OFFLINE = "1"
$env:TRANSFORMERS_OFFLINE = "1"
$env:HF_DATASETS_OFFLINE = "1"
Write-Host "[Offline] Hugging Face cache: $env:HUGGINGFACE_HUB_CACHE" -ForegroundColor Cyan
$env:VAAKSETU_TTS_MODEL_DIR = if ($env:VAAKSETU_TTS_MODEL_DIR) { $env:VAAKSETU_TTS_MODEL_DIR } else { Join-Path $RootDir "models\tts" }
Write-Host "[Offline] TTS model directory: $env:VAAKSETU_TTS_MODEL_DIR" -ForegroundColor Cyan

# ── Start Service ─────────────────────────────────────────────
$Port = if ($env:LOCAL_AI_PORT) { $env:LOCAL_AI_PORT } else { "8000" }
Write-Host "[Start] Launching on http://127.0.0.1:$Port ..." -ForegroundColor Green

Set-Location $RootDir
& $Python "$RootDir\mini-services\local_ai_service.py"
