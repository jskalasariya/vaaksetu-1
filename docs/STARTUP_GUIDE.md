# 📖 VaakSetu (वाक्सेतु) — End-to-End Startup Guide & User Manual

Welcome to **VaakSetu**! This guide takes you step-by-step from cloning the repository to running the full product locally, including the Next.js web application and the high-performance local AI engine.

For a Windows-only setup with exact PowerShell commands, see the dedicated
[Windows Setup Guide](WINDOWS_SETUP.md).

---

## 📋 System Prerequisites

Before starting, ensure you have the following installed on your machine:

| Component | Minimum Version | Installation / Command |
|---|---|---|
| **Node.js** or **Bun** | Node ≥ 20 LTS / Bun ≥ 1.1 | `bun --version` or `node -v` |
| **Python** | Python 3.10 – 3.12 | `python3 --version` or `py -V` |
| **FFmpeg** | FFmpeg 5.x+ | `ffmpeg -version` |
| **Git** | Any recent version | `git --version` |

### Windows prerequisites

Open **PowerShell** and install Python 3.12 with `winget`:

```powershell
winget install Python.Python.3.12 --version 3.12.0
winget install Gyan.FFmpeg
winget install Microsoft.VCRedist.2015+.x64
```

The Visual C++ Redistributable is required at runtime by PyTorch. Restart
PowerShell after these installs so the updated `PATH` is visible.

The standard Windows dependency install does not require Visual Studio C++:
`IndicTransToolkit` is skipped and the service uses the NLLB translation
fallback. To enable the higher-quality IndicTrans2 path, install Visual Studio
Build Tools and select the **Desktop development with C++** workload:

```powershell
winget install Microsoft.VisualStudio.2022.BuildTools
```

If Build Tools is already installed without that workload, run this command in
an **elevated PowerShell** (Run as Administrator). The `--wait` option must not
be added; this Visual Studio Installer version does not support it:

```powershell
$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
& $vsInstaller modify --installPath "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart
```

This workload provides MSVC 14+ and the Windows SDK required to build
`IndicTransToolkit`. Close that window and open an **x64 Native Tools PowerShell
for VS 2022** (or launch the developer shell manually), then install the
optional processor from the activated virtual environment:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64 -HostArch amd64
.\.venv\Scripts\Activate.ps1
python -m pip install IndicTransToolkit
```

Close and reopen PowerShell, then verify the installations:

```powershell
py -3.12 --version
python --version
where.exe cl.exe
python -c "from IndicTransToolkit.processor import IndicProcessor; print('IndicTransToolkit OK')"
```

The expected Python version is `3.12.x`, and `where.exe cl.exe` should return
an MSVC compiler path. If `python` still resolves to a different installation,
use `py -3.12` in the commands below.

> [!TIP]
> **FFmpeg Quick Install:**
> - **macOS**: `brew install ffmpeg`
> - **Ubuntu/Debian**: `sudo apt install ffmpeg`
> - **Windows**: `winget install Gyan.FFmpeg` or `choco install ffmpeg`

---

## ⚡ Quick Start (2-Step Method)

If you have your environment set up, you can start everything in two terminal windows:

### Terminal 1: Start the Local AI Engine
```bash
# macOS / Linux:
./scripts/start-local-ai.sh

# Windows (PowerShell):
.\scripts\start-local-ai.ps1

# Universal (Python launcher):
python3 scripts/start-local-ai.py
```
> The Local AI Engine will boot at **`http://127.0.0.1:8000`** with hardware auto-detection (Apple Silicon MPS / NVIDIA CUDA / CPU).

### Terminal 2: Start the Web Portal
```bash
bun install        # or npm install
bun run db:push    # or npx prisma db push
bun run dev        # or npm run dev
```
> Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## 🛠️ Step-by-Step Detailed Manual

### Step 1: Clone & Configure Environment

1. Navigate to the project root:
   ```bash
   cd VaakSetu
   ```

2. Create your `.env` configuration file:
   ```bash
   cp .env.example .env
   ```

3. Configure variables in `.env` (optional for local mode, required for cloud fallbacks):
   ```env
   # Local database (SQLite zero-config)
   DATABASE_URL="file:./db/custom.db"

   # Local AI Microservice URL (Default: http://127.0.0.1:8000)
   LOCAL_AI_URL="http://127.0.0.1:8000"
   AI_MODE="local"

   # Compute device: auto (recommended), cuda, or cpu
   VAAKSETU_DEVICE="auto"
   VAAKSETU_GPU_INDEX="0"

   # Optional: Hugging Face Token (Needed only once if downloading gated Indic models)
   HF_TOKEN="hf_your_token_here"

   # Optional: Cloud fallback keys (if local engine is offline)
   GEMINI_API_KEY=""
   BHASHINI_API_KEY=""
   BHASHINI_INFERENCE_API_KEY=""
   ```

---

### Step 2: Set Up the Python AI Microservice

The local AI microservice handles neural translation (IndicTrans2), Whisper speech-to-text, neural TTS voice synthesis, and video dubbing.

1. Create and activate a Python virtual environment.

   On Windows PowerShell:
   ```powershell
   py -3.12 -m venv venv
   .\venv\Scripts\Activate.ps1
   python --version
   ```

   On macOS/Linux:
   ```bash
   python3 -m venv venv
   ```

2. Install Python dependencies:
   ```powershell
   python -m pip install -r mini-services/requirements.txt
   ```

   On Windows this command intentionally skips `IndicTransToolkit`, so it does
   not require a C++ compiler. The service will report that the processor is
   unavailable and use the NLLB fallback. If the optional processor was
   installed, verify it with `python -c "from IndicTransToolkit.processor import IndicProcessor; print('ok')"`.

3. Launch the AI microservice:
   ```bash
   python mini-services/local_ai_service.py
   # Service starts on http://127.0.0.1:8000
   ```

4. Verify health check:
   Open [http://127.0.0.1:8000/health](http://127.0.0.1:8000/health) in your browser. You should see a JSON response showing system device (`mps`, `cuda`, or `cpu`) and available models.

### Download models for offline use

Download all translation and transcription models used by the local service on
an internet-connected machine:

python scripts/download-models.py
```

The script stores them in the standard Hugging Face cache:

```text
%USERPROFILE%\.cache\huggingface\hub
```

To stage the cache directly on a USB drive:

```powershell
python scripts/download-models.py --cache-dir E:\vaaksetu-model-cache
```

Copy that cache to the target laptop's `%USERPROFILE%\.cache\huggingface\hub`.
For a custom location, set `HUGGINGFACE_HUB_CACHE` to the exact cache directory
before starting the local AI service, for example:

running the command again.
Download only selected groups when USB space is limited:

```powershell
python scripts/download-models.py --model whisper --model nllb
Translated voice generation uses the local `pyttsx3` OS voice engine and does
not contact Edge TTS or gTTS. Install the required Windows language voices on
the machine; the service automatically selects a matching installed voice and
otherwise uses the system default voice.

### Step 3: Set Up the Next.js Frontend & Database
1. In a new terminal, install frontend dependencies:
   ```bash
   bun install
   ```

2. Initialize the SQLite database schema:
   ```bash
   bun run db:push

   ```bash
   bun run dev
   # or: npm run dev
   http://localhost:3000
   ```

---

## 🎯 Testing & Verification

To verify that your entire pipeline is working end-to-end:

### 1. Test Text Translation
1. Open the web portal at `http://localhost:3000`.
2. Click **Text Translation** in the left sidebar.
3. Select **Source: Marathi** and **Target: Hindi**.
4. Type: `नमस्कार, वाक्सेतु मध्ये आपले स्वागत आहे.`
5. Click **Translate**. Verify the translated output appears in Hindi.

### 2. Test Media / Video Dubbing Pipeline
You can run our automated end-to-end Marathi-to-Hindi video pipeline test script:
```bash
bun run scripts/test-marathi-to-hindi-pipeline.ts
# or: npx tsx scripts/test-marathi-to-hindi-pipeline.ts
```
This script will:
- Synthesize real multi-sentence Marathi audio.
- Create an MP4 video test container with FFmpeg.
- Perform Whisper speech recognition with segment timestamps.
- Translate Marathi text to Hindi.
- Synthesize synchronized Hindi audio voiceovers without truncation.
- Mux the dubbed Hindi audio back into the video and generate dual `.srt` subtitles.

---

## ❓ Frequently Asked Questions & Troubleshooting

### 1. `Error: connect ECONNREFUSED 127.0.0.1:8000`
- **Cause:** The Python Local AI service is not running.
- **Fix:** Run `./scripts/start-local-ai.sh` (or `python mini-services/local_ai_service.py`).

### 2. `ffmpeg is not recognized as an internal or external command`
- **Cause:** FFmpeg is either not installed or not added to your system's `PATH`.
- **Fix:** Install FFmpeg and verify with `ffmpeg -version`.

### 3. Port 3000 or 8000 is already in use
- **To find and free port 3000 (macOS/Linux):**
  ```bash
  lsof -ti :3000 | xargs kill -9
  ```
- **To find and free port 8000 (macOS/Linux):**
  ```bash
  lsof -ti :8000 | xargs kill -9
  ```

### 4. Running 100% Offline (Air-Gapped)
- Once the Hugging Face models (or Whisper weights) are downloaded the first time into `~/.cache/huggingface/hub/`, disconnect your internet.
- The app and all translation/media engines will function without any external network access.

---

## 📦 Related Documentation

- 📐 **[Architecture Overview](ARCHITECTURE.md)**: Deep dive into Clean Architecture & DDD design.
- 💻 **[Desktop Application Build Guide](BUILD.md)**: How to package VaakSetu into a standalone Windows `.exe` / macOS installer.
- 🏢 **[On-Premises Deployment Guide](DEPLOYMENT.md)**: Enterprise deployment and server configurations.
- 🎯 **[Model Fine-Tuning Guide](FINE_TUNE.md)**: How to fine-tune local models for custom regional dialects and agriculture terminology.
