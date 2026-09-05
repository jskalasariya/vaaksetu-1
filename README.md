<div align="center">

# 🌉 VaakSetu (वाक्सेतु)
### *Offline Multilingual Translation & Media Intelligence Suite*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16.1-black?logo=next.js)](https://nextjs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4.0-38B2AC?logo=tailwind-css)](https://tailwindcss.com/)
[![Electron](https://img.shields.io/badge/Electron-Desktop_App-47848F?logo=electron)](https://www.electronjs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-SQLite%20%2F%20Postgres-2D3748?logo=prisma)](https://www.prisma.io/)
[![AI4Bharat](https://img.shields.io/badge/AI4Bharat-IndicTrans2%20%26%20IndicTTS-FF9933)](https://ai4bharat.iitm.ac.in/)
[![Whisper](https://img.shields.io/badge/OpenAI-Whisper_ASR-00A67E?logo=openai)](https://github.com/openai/whisper)

<p align="center">
  <strong>Bridging languages across English, Hindi, and Marathi with 100% offline, on-premises AI.</strong>
</p>

<p align="center">
  <a href="#-overview">Overview</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-tech-stack">Tech Stack</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-desktop-app-build">Desktop Build</a> •
  <a href="#-deployment">Deployment</a> •
  <a href="#-documentation">Docs</a>
</p>

---

</div>

## 📖 Overview

**VaakSetu (वाक्सेतु · "Bridge of Speech")** is a privacy-first, on-premises multilingual translation and media intelligence suite built for rural empowerment, field operations, and bandwidth-constrained environments. Developed for **BAIF Development Research Foundation** (Tech for Good), it breaks language barriers across **Marathi (मराठी), Hindi (हिंदी), and English** for field staff, agricultural researchers, and rural communities.

Operating **100% offline and on-premises**, VaakSetu guarantees zero cloud egress, zero recurring API costs, and strict data sovereignty. It processes raw text, audio recordings, field videos, and domain documents into synchronized translations, natural synthesized speech, translated video subtitles, and conversational intelligence.

---

## ✨ Key Capabilities

| Module | Description | Supported Formats / Features |
|---|---|---|
| 📝 **Text & Batch Translation** | High-fidelity translation powered by AI4Bharat IndicTrans2 with context preservation and agricultural domain term adherence. | Single text, multi-file batch upload (TXT, MD, CSV, JSON, DOCX, PDF) |
| 🎙️ **Media Translation & Subtitles** | End-to-end media transcription (ASR), translation, subtitle generation, and audio voiceover synthesis. | Audio (`.mp3`, `.wav`, `.m4a`, `.ogg`), Video (`.mp4`, `.mkv`, `.mov`), Subtitles (`.srt`, `.vtt`, burned-in video) |
| 💬 **Interactive Document Q&A** | Voice-first and text-based interactive conversational chat with uploaded knowledge documents in native Indic languages. | PDF, DOCX, Markdown, Text with bi-directional speech I/O (Mic in, TTS voice out) |
| 📖 **Glossary & Terminology Manager** | Custom dictionary management enforcing standardized agricultural, livestock, and local vernacular terminology across all translations. | Dynamic term pairs, domain categories, regex/token replacement rules |
| 📄 **Summarization Engine** | Generates concise extractive and abstractive bulleted summaries in the reader's preferred language. | Multilingual executive summaries, key takeaways, and action items |
| 🔄 **Media & Subtitle Converter** | Standalone utility to convert, clean, adjust timing offsets, and transcode media and subtitle files locally. | SRT ↔ VTT, Audio normalization, 16kHz mono WAV extraction |
| 🎯 **Domain Model Fine-Tuning** | In-app dataset curation, parameter configuration, and fine-tuning pipeline to customize local models for regional dialects and domain terms. | LoRA / QLoRA adapters, training telemetry, evaluation metrics |
| 📜 **Job History & Audit Trail** | Persistent audit log of all translation jobs with search, multi-criteria filtering, instant preview, and multi-format export. | SQLite / PostgreSQL storage, batch download ZIP, CSV export |

---

## 🏛️ Architecture & Clean Design

VaakSetu follows **Clean Architecture & Domain-Driven Design (DDD)** with strict separation of concerns and unidirectional dependencies:

```text
┌─────────────────────────────────────────────────────────────┐
│  Presentation Layer (src/app, src/components/app)           │
│  Next.js 16 + React 19 Views, Tailwind CSS, shadcn/ui       │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTP / JSON API
┌──────────────────────────────▼──────────────────────────────┐
│  Application Layer (src/lib/application)                    │
│  ModelSelector · TextTranslator · MediaTranslator ·         │
│  DocumentChatService · Summarizer · SubtitleConverter ·     │
│  AudioConverter · FineTuneService                           │
└──────────────────────────────┬──────────────────────────────┘
                               │ Depends on Contracts (Ports)
┌──────────────────────────────▼──────────────────────────────┐
│  Domain Layer (src/lib/domain)                              │
│  Languages · Media Formats · Models · Entities (Pure TS)    │
└──────────────────────────────▲──────────────────────────────┘
                               │ Implemented by Adapters
┌──────────────────────────────┴──────────────────────────────┐
│  Infrastructure Layer (src/lib/infrastructure)              │
│  ├── AI Ports & Engine Contracts (engine-contract.ts)       │
│  ├── On-Premises Adapter (IndicTrans2, Whisper, Indic-TTS)  │
│  ├── Cloud / Demo Fallback Adapter (Bhashini / HuggingFace) │
│  ├── Repositories & Database (Prisma ORM + SQLite / Postgres)│
│  └── Storage Engine (Local filesystem / Network attached)   │
└─────────────────────────────────────────────────────────────┘
```

### ⚙️ Media Processing Pipeline

```text
Upload (Audio / Video)
       │
       ▼
ffprobe (metadata / duration) ──► ffmpeg (extract 16kHz mono WAV)
                                          │
                                          ▼
                                   Whisper ASR (Timestamps + Segments)
                                          │
                                          ▼
                                   IndicTrans2 (Segment Translation)
                                          │
                  ┌───────────────────────┴───────────────────────┐
                  ▼                                               ▼
      Generate SRT / VTT Subtitles                      Indic-TTS (Voiceover)
                  │                                               │
                  └───────────────────────┬───────────────────────┘
                                          ▼
                         ffmpeg (Optional Subtitle Burn-In)
                                          │
                                          ▼
                             Persist to DB & Storage
```

---

## 🛠️ Technology Stack

- **Frontend**: [Next.js 16 (App Router)](https://nextjs.org/), [React 19](https://react.dev/), [Tailwind CSS v4](https://tailwindcss.com/), [shadcn/ui](https://ui.shadcn.com/), [Framer Motion](https://www.framer.com/motion/), Lucide Icons
- **Desktop Runtime**: [Electron](https://www.electronjs.org/) + [electron-builder](https://www.electron.build/) (Windows `.exe`, macOS `.dmg`, Linux `.AppImage`)
- **Backend & API**: Next.js Server Actions & API Routes, Bun / Node.js runtime
- **Data Persistence**: [Prisma ORM](https://www.prisma.io/) with SQLite (local zero-config) or PostgreSQL
- **Media Transcoding**: [FFmpeg](https://ffmpeg.org/) & [FFprobe](https://ffmpeg.org/ffprobe.html)
- **AI & NLP Stack**:
  - **Machine Translation**: [AI4Bharat IndicTrans2](https://github.com/AI4Bharat/IndicTrans2) (En ↔ Indic, Indic ↔ Indic)
  - **Speech Recognition (ASR)**: [OpenAI Whisper](https://github.com/openai/whisper) (Open-source, MIT)
  - **Speech Synthesis (TTS)**: [AI4Bharat Indic-TTS](https://github.com/AI4Bharat/Indic-TTS)
  - **Document Intelligence**: Open-source Indic LLMs / Gemini / Bhashini API

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js ≥ 20 LTS** or **[Bun](https://bun.sh/) ≥ 1.1** (recommended)
- **ffmpeg** installed and available in `PATH`
- **Git**

#### Windows IndicTrans2 prerequisite

Windows installs can use the NLLB fallback without a C++ compiler. To enable
IndicTrans2, install the MSVC workload from an **elevated PowerShell**. This
command intentionally omits `--wait`, which is unsupported by recent Visual
Studio installers:

```powershell
$vsInstaller = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\setup.exe"
& $vsInstaller modify --installPath "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools" --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --passive --norestart
```

Then open a developer PowerShell and install the native processor in the
project virtual environment:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\Launch-VsDevShell.ps1" -Arch amd64 -HostArch amd64
.\.venv\Scripts\Activate.ps1
python -m pip install IndicTransToolkit
python -c "from IndicTransToolkit.processor import IndicProcessor; print('IndicTransToolkit OK')"
```

### 2. Installation

```bash
# Clone the repository
git clone https://github.com/your-username/VaakSetu.git
cd VaakSetu

# Install dependencies
bun install
# or: npm install
```

### 3. Environment Configuration

Copy the example environment file and update if needed:

```bash
cp .env.example .env
```

```env
# Database configuration (default is local SQLite)
DATABASE_URL="file:./db/custom.db"

# Optional Cloud / Fallback Keys (Not required for on-premise local engine mode)
GEMINI_API_KEY=""
BHASHINI_USER_ID=""
BHASHINI_API_KEY=""
BHASHINI_INFERENCE_API_KEY=""
HF_TOKEN=""
```

### 4. Database Setup

```bash
# Generate Prisma Client & initialize SQLite database
bun run db:push
# or: npx prisma db push
```

### 5. Run Development Server

```bash
bun run dev
# or: npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to launch the VaakSetu portal.

---

## 💻 Desktop Application (`.exe`) Build

VaakSetu can be packaged into a standalone desktop executable for field laptops without requiring pre-installed web servers or developer tools:

```bash
# 1. Compile Electron main & preload scripts
bunx tsc electron/main.ts electron/preload.ts --module commonjs --target es2020 --esModuleInterop --outDir electron/dist --skipLibCheck

# 2. Build Next.js standalone bundle
bun run build

# 3. Package installer using electron-builder
bunx electron-builder --config electron-builder.yml
```

The resulting standalone executable (`VaakSetu-Setup-x64.exe` or portable binary) will be generated in the `release/` folder. For full packaging instructions, see [docs/BUILD.md](docs/BUILD.md).

---

## 🏢 On-Premises & Offline Deployment

To deploy in completely air-gapped environments:

1. Download model checkpoints locally:
   - **IndicTrans2**: `indictrans2-en-indic`, `indictrans2-indic-en`, `indictrans2-indic-indic`
   - **Whisper**: `whisper-small` / `whisper-medium`
   - **Indic-TTS**: AI4Bharat Indic-TTS voice models
2. Transfer model files to the target machine under `models/`.
3. Enable the on-premise adapter in configuration.

For complete hardware sizing, GPU requirements, and step-by-step setup, see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## 📚 Project Documentation

- 📖 **[Startup Guide & User Manual](docs/STARTUP_GUIDE.md)**: Complete step-by-step instructions for running the app end-to-end.
- 🪟 **[Windows Setup Guide](docs/WINDOWS_SETUP.md)**: Dedicated Windows installation, MSVC/IndicTrans2 setup, model download, database, and offline deployment steps.
- 📐 **[Architecture Guide](docs/ARCHITECTURE.md)**: DDD breakdown, engine contracts, and domain layers.
- 🚀 **[Deployment Guide](docs/DEPLOYMENT.md)**: On-premises hardware requirements, offline model setup, and production hardening.
- 📦 **[Desktop Build Guide](docs/BUILD.md)**: Compiling and packaging standalone desktop binaries (`.exe` / `.dmg`).
- 🧠 **[Fine-Tuning Guide](docs/FINE_TUNE.md)**: Dataset formatting, LoRA training instructions, and custom domain adaptation.

---

## 🤝 Acknowledgements & Open-Source Foundations

VaakSetu is made possible thanks to pioneering open-source research and tools:
- **[AI4Bharat (IIT Madras)](https://ai4bharat.iitm.ac.in/)** for IndicTrans2 and Indic-TTS.
- **[OpenAI](https://github.com/openai/whisper)** for the Whisper Automatic Speech Recognition model.
- **[BAIF Development Research Foundation](https://baif.org.in/)** for domain guidance and rural field use cases.
- **[Bhashini](https://bhashini.gov.in/)** (National Language Translation Mission, Government of India).

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
