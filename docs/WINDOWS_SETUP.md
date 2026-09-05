# VaakSetu Windows Setup Guide

This guide sets up VaakSetu on Windows 10/11 for local development and local AI
translation. Use PowerShell unless a command says otherwise.

## 1. Install system prerequisites

Open a normal PowerShell and install Python, Node.js, FFmpeg, and the Visual C++
runtime:

```powershell
winget install Python.Python.3.12 --version 3.12.0
winget install OpenJS.NodeJS.LTS
winget install Gyan.FFmpeg
winget install Microsoft.VCRedist.2015+.x64
```

Close and reopen PowerShell, then verify:

```powershell
py -3.12 --version
node --version
npm --version
ffmpeg -version
ffprobe -version
```

Python should report `3.12.x`. Node.js should be version 20 or newer.

## 2. Optional NVIDIA GPU setup

The local service defaults to automatic device detection. On Windows, an
NVIDIA GPU is used only when the NVIDIA driver and CUDA-enabled PyTorch are
available. Check the driver first:

```powershell
nvidia-smi
```

Complete sections 3 through 6 first so `.venv` and the base dependencies exist.
Then, from the project root, install the CUDA Python stack with the project
script:

```powershell
.\.venv\Scripts\Activate.ps1
.\scripts\install-windows-cuda.ps1 -CudaIndex cu121
```

The script installs the base dependencies, replaces CPU PyTorch with the
selected CUDA wheel, installs CUDA libraries used by faster-whisper, and fails
if PyTorch cannot see the GPU. Verify manually:

```powershell
python -c "import torch; print(torch.cuda.is_available()); print(torch.version.cuda); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no CUDA GPU')"
```

Use these `.env` settings for automatic selection:

```env
VAAKSETU_DEVICE="auto"
VAAKSETU_GPU_INDEX="0"
VAAKSETU_1B_VRAM_GB="6.0"
VAAKSETU_MAX_LOADED_MODELS="1"
```

Set `VAAKSETU_DEVICE="cuda"` only after verification succeeds. It fails clearly
if CUDA becomes unavailable instead of silently switching to CPU. Use
`VAAKSETU_DEVICE="cpu"` for troubleshooting.

The same settings are portable across macOS and Linux. On macOS, leave the
device as `auto` so Apple Silicon can use MPS and Intel Macs use CPU. Whisper
continues to use CPU on MPS because CTranslate2 does not support Apple MPS.

## 3. Get the project

```powershell
git clone <repository-url> VaakSetu
Set-Location .\VaakSetu
```

If the project is already present:

```powershell
Set-Location D:\projects\VaakSetu
```

## 4. Install frontend dependencies

Use either npm or Bun. This guide uses npm because it is included with Node.js:

```powershell
npm install
```

## 5. Create the Python environment

Create and activate the virtual environment in the project root:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python --version
python -m pip install --upgrade pip setuptools wheel
```

If PowerShell blocks activation, run this once in the current user account:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Then activate again:

```powershell
.\.venv\Scripts\Activate.ps1
```

## 6. Install Python dependencies

```powershell
python -m pip install -r .\mini-services\requirements.txt
python -m pip check
```

On Windows, the requirements file intentionally skips `IndicTransToolkit` because
it contains a native Cython extension. The service can run with the NLLB fallback
without the toolkit. The next section enables the higher-quality IndicTrans2
path.

## 7. Enable IndicTrans2 on Windows

### 7.1 Install the MSVC C++ workload

Open a new **PowerShell as Administrator** and run this exact command:

```powershell
$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
& $vsInstaller modify --installPath "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart
```

Do not add `--wait`. The installed Visual Studio Installer does not support that
option. The command must be started elevated or it can fail with exit code `5007`.

If Build Tools is not installed yet, install it first:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

After the installer finishes, close the Administrator PowerShell.

### 7.2 Install IndicTransToolkit

Open an **x64 Native Tools PowerShell for VS 2022**. Alternatively, launch the
developer shell manually from a normal PowerShell:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64 -HostArch amd64
Set-Location D:\projects\VaakSetu
.\.venv\Scripts\Activate.ps1
where.exe cl.exe
python -m pip install IndicTransToolkit
python -c "from IndicTransToolkit.processor import IndicProcessor; print('IndicTransToolkit OK')"
```

`where.exe cl.exe` must print an MSVC compiler path. If it prints nothing, the
C++ workload was not installed correctly; repeat section 6.1 from an elevated
PowerShell.

## 8. Configure environment variables

Create `.env` from the example if it does not exist:

```powershell
if (-not (Test-Path .\.env)) { Copy-Item .\.env.example .\.env }
```

For local operation, these values are sufficient:

```env
DATABASE_URL="file:./db/custom.db"
LOCAL_AI_URL="http://127.0.0.1:8000"
AI_MODE="local"
HF_TOKEN=""
```

The Settings page also provides an **AI execution mode** switch. `local` uses
the local AI service and system RAM. `remote` tries configured Bhashini,
Gemini, or Hugging Face APIs first; when credentials are missing or a remote
request fails, the event is logged and the request falls back to local AI.

A Hugging Face token is only needed for gated model downloads. Do not commit a
real token to the repository.

## 9. Initialize the database

Run this from the project root:

```powershell
New-Item -ItemType Directory -Force .\prisma\db | Out-Null
npx prisma generate
npx prisma db push
```

The application database is created at:

```text
D:\projects\VaakSetu\prisma\db\custom.db
```

Do not use the empty root-level `db\custom.db` file. The application resolves
Prisma's relative SQLite URL from the `prisma` schema directory.

## 10. Download models while internet is available

Activate the Python environment and run:

```powershell
.\.venv\Scripts\Activate.ps1
python .\scripts\download-models.py
```

This downloads:

- IndicTrans2 distilled and 1B translation models
- NLLB-200 distilled 600M fallback
- Whisper large-v3-turbo, medium, and small

The default cache is:

```text
%USERPROFILE%\.cache\huggingface\hub
```

To download directly to a USB drive:

```powershell
python .\scripts\download-models.py --cache-dir E:\vaaksetu-model-cache
```

The downloader reuses completed files and resumes partial downloads. It is safe
to run again after a network interruption.

To use a copied USB cache on this laptop:

```powershell
$env:HUGGINGFACE_HUB_CACHE = 'E:\vaaksetu-model-cache'
```

Set this variable in every PowerShell session before starting the AI service, or
copy the cache to `%USERPROFILE%\.cache\huggingface\hub`.

## 11. Start the local AI service

Open PowerShell window 1:

```powershell
Set-Location D:\projects\VaakSetu
.\.venv\Scripts\Activate.ps1
.\scripts\start-local-ai.ps1
```

Verify the service:

```powershell
Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing | Select-Object -ExpandProperty Content
```

The first request that uses Whisper or translation can take time while the model
is loaded. The first model download must happen while internet is available.

## 12. Start the web application

Open PowerShell window 2:

```powershell
Set-Location D:\projects\VaakSetu
npm run dev
```

Open:

```text
http://localhost:3000
```

Verify the database APIs:

```powershell
Invoke-WebRequest 'http://localhost:3000/api/jobs?limit=5' -UseBasicParsing | Select-Object -ExpandProperty Content
```

Expected result for a new database:

```json
{"jobs":[]}
```

## 13. Offline laptop checklist

Before disconnecting the internet, confirm that these items are available:

- Project source and `node_modules`
- `.venv` or offline Python wheels
- `%USERPROFILE%\.cache\huggingface\hub` model cache
- `prisma\db\custom.db`, if existing jobs must be preserved
- FFmpeg and FFprobe on `PATH`
- Visual C++ Redistributable
- MSVC Build Tools and `IndicTransToolkit` if IndicTrans2 is required

Start the offline laptop in this order:

```powershell
# PowerShell window 1
.\.venv\Scripts\Activate.ps1
.\scripts\start-local-ai.ps1

# PowerShell window 2
npm run dev
```

The current TTS implementation uses Edge TTS and gTTS, both of which require
network access. Whisper, NLLB, and IndicTrans2 can run locally when their models
and dependencies are installed.

## Troubleshooting

### `Microsoft Visual C++ 14.0 or greater is required`

The MSVC compiler is missing from the active shell. Run section 6.1 as
Administrator, open the developer shell, verify `where.exe cl.exe`, then retry:

```powershell
python -m pip install IndicTransToolkit
```

### `Error code 14: Unable to open the database file`

The database directory or path is wrong. Run:

```powershell
New-Item -ItemType Directory -Force .\prisma\db
npx prisma db push
```

Stop Next.js before running Prisma commands if Prisma reports a Windows file-lock
or `EPERM` error.

### `WinError 1114` or `c10.dll` when importing PyTorch

Install the x64 Visual C++ Redistributable, restart PowerShell, and test:

```powershell
winget install Microsoft.VCRedist.2015+.x64
.\.venv\Scripts\Activate.ps1
python -c "import torch; print(torch.__version__)"
```

### Models try to download while offline

The cache is missing or the cache variable points to the wrong directory:

```powershell
$env:HUGGINGFACE_HUB_CACHE = "$env:USERPROFILE\.cache\huggingface\hub"
Get-ChildItem $env:HUGGINGFACE_HUB_CACHE
```

Ensure the relevant `models--...` directories are present before starting the
service.

### Text translation is slow or health shows NLLB

Check the local service health response:

```powershell
(Invoke-WebRequest http://127.0.0.1:8000/health -UseBasicParsing).Content
```

For IndicTrans2, these fields should be true:

```json
"has_indictrans2": true,
"has_processor": true
```

If `active_models` contains only `facebook/nllb-200-distilled-600M`, the
IndicTrans2 cache is missing model weights or the service started before the
toolkit was installed. While internet is available, rerun:

```powershell
.\.venv\Scripts\Activate.ps1
python .\scripts\download-models.py --model indictrans
```

The downloader reads `HF_TOKEN` from the project `.env`, resumes partial files,
and now fails clearly if a repository contains only `README.md` and `LICENSE`.
Restart the local AI service after the download:

```powershell
.\scripts\start-local-ai.ps1
```

The first translation after service startup includes model loading. Subsequent
translations reuse the loaded model. CPU-only inference is slower than CUDA;
for responsive text translation, use the distilled IndicTrans2 model and keep
the local service running between requests.
