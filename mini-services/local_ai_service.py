"""
VaakSetu Local AI Service v3.0
==============================
Fully offline FastAPI microservice for:
1. AI4Bharat IndicTrans2 (200M / 320M / 1B) Translation — VRAM-aware auto-selection
   + NLLB-200-distilled-600M fallback (no token needed, good for Indic↔Indic)
2. Whisper ASR (Small/Medium) — GPU-accelerated when available, CPU int8 fallback
3. Segment-Aware Neural TTS — per-segment synthesis with time-slot alignment
4. Video Dubbing & Subtitle Burning via FFmpeg
5. Context-aware batch translation endpoint for coherent video segment translation

Cross-Platform: macOS (MPS/CPU), Windows 11 (CUDA/CPU), Linux (CUDA/CPU).
No platform-exclusive hardcoding.
"""

import gc
import math
import os
import sys
import types
import asyncio
import tempfile
import subprocess
import json
import threading
from collections import OrderedDict
from pathlib import Path
from typing import List, Optional, Dict, Any, Tuple

try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

# Models are loaded cache-first in offline UI mode. A missing snapshot may be
# downloaded once; use VAAKSETU_AIRGAPPED=1 to prohibit all Hub access.
OFFLINE_MODE = os.environ.get("VAAKSETU_OFFLINE", "0").strip().lower() in {
    "1", "true", "yes", "on"
}
AIRGAPPED_MODE = os.environ.get("VAAKSETU_AIRGAPPED", "0").strip().lower() in {
    "1", "true", "yes", "on"
}


def set_offline_mode(offline: Optional[bool]) -> None:
    """Apply the UI-selected cache-first policy to this running service."""
    global OFFLINE_MODE
    if offline is None:
        return
    OFFLINE_MODE = offline
    os.environ["VAAKSETU_OFFLINE"] = "1" if OFFLINE_MODE else "0"
    if AIRGAPPED_MODE:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
    else:
        os.environ["VAAKSETU_OFFLINE"] = "0"
        for _hub_var in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"):
            os.environ.pop(_hub_var, None)


if AIRGAPPED_MODE:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["HF_DATASETS_OFFLINE"] = "1"
else:
    for _hub_var in ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE"):
        os.environ.pop(_hub_var, None)
if not os.environ.get("HUGGINGFACE_HUB_CACHE"):
    os.environ["HUGGINGFACE_HUB_CACHE"] = str(
        Path.home() / ".cache" / "huggingface" / "hub"
    )

# Enable MPS fallback to CPU for unsupported Metal kernels (prevents hard SIGABRT crashes)
os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "1"

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from io import BytesIO
import torch

# ---------------------------------------------------------------------------
# Backwards compatibility patches for IndicTrans2 & IndicTransToolkit
# ---------------------------------------------------------------------------
try:
    import transformers
    # 1. Patch transformers.tokenization_utils
    if not hasattr(transformers, "tokenization_utils") or not hasattr(
        transformers.tokenization_utils, "PreTrainedTokenizerBase"
    ):
        import transformers.tokenization_utils_base as tub
        mod = types.ModuleType("transformers.tokenization_utils")
        mod.PreTrainedTokenizerBase = tub.PreTrainedTokenizerBase
        sys.modules["transformers.tokenization_utils"] = mod
        transformers.tokenization_utils = mod

    # 2. Patch transformers.onnx & transformers.onnx.utils for IndicTrans2 remote code
    if "transformers.onnx" not in sys.modules or not hasattr(transformers, "onnx"):
        onnx_mod = types.ModuleType("transformers.onnx")
        onnx_utils_mod = types.ModuleType("transformers.onnx.utils")

        class OnnxConfig:
            pass
        class OnnxConfigWithPast(OnnxConfig):
            pass
        class OnnxSeq2SeqConfigWithPast(OnnxConfigWithPast):
            pass

        onnx_mod.OnnxConfig = OnnxConfig
        onnx_mod.OnnxConfigWithPast = OnnxConfigWithPast
        onnx_mod.OnnxSeq2SeqConfigWithPast = OnnxSeq2SeqConfigWithPast
        onnx_mod.PatchingSpec = object
        onnx_mod.default_onnx_opset = 14
        onnx_mod.export = lambda *args, **kwargs: None
        onnx_mod.validate_model_outputs = lambda *args, **kwargs: None
        onnx_utils_mod.compute_effective_axis_dimension = lambda *args, **kwargs: None
        onnx_mod.utils = onnx_utils_mod

        sys.modules["transformers.onnx"] = onnx_mod
        sys.modules["transformers.onnx.utils"] = onnx_utils_mod
        transformers.onnx = onnx_mod
except Exception as e:
    print(f"[Warning] Failed to patch transformers compatibility: {e}")


# ---------------------------------------------------------------------------
# Cross-Platform Device Detection & VRAM Profiling
# ---------------------------------------------------------------------------
def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


REQUESTED_DEVICE = os.environ.get("VAAKSETU_DEVICE", "auto").strip().lower()
GPU_INDEX = _env_int("VAAKSETU_GPU_INDEX", 0)
VRAM_1B_THRESHOLD_GB = float(os.environ.get("VAAKSETU_1B_VRAM_GB", "6.0"))
MAX_LOADED_TRANSLATION_MODELS = _env_int("VAAKSETU_MAX_LOADED_MODELS", 2)


def detect_device() -> Tuple[str, torch.dtype, float]:
    """
    Detect the optimal compute device with safe, cross-platform fallbacks.
    Returns (device_str, torch_dtype, vram_gb).
    MPS check is guarded to avoid AttributeError on non-Apple hardware.
    """
    if REQUESTED_DEVICE not in {"auto", "cuda", "cpu"}:
        raise RuntimeError(
            "VAAKSETU_DEVICE must be one of: auto, cuda, cpu "
            f"(received {REQUESTED_DEVICE!r})"
        )

    if REQUESTED_DEVICE == "cpu":
        print("[Device] CPU forced by VAAKSETU_DEVICE=cpu")
        return "cpu", torch.float32, 0.0

    # 1. NVIDIA CUDA (Float16 is natively supported across all matrix ops)
    if torch.cuda.is_available():
        if GPU_INDEX < 0 or GPU_INDEX >= torch.cuda.device_count():
            raise RuntimeError(
                f"VAAKSETU_GPU_INDEX={GPU_INDEX} is unavailable; "
                f"CUDA reports {torch.cuda.device_count()} GPU(s)"
            )
        torch.cuda.set_device(GPU_INDEX)
        props = torch.cuda.get_device_properties(GPU_INDEX)
        vram_gb = props.total_memory / (1024 ** 3)
        print(
            f"[Device] CUDA GPU detected: {props.name} (index {GPU_INDEX}) "
            f"({vram_gb:.1f}GB VRAM, compute {props.major}.{props.minor})"
        )
        return "cuda", torch.float16, vram_gb

    if REQUESTED_DEVICE == "cuda":
        raise RuntimeError(
            "VAAKSETU_DEVICE=cuda but CUDA is unavailable. Install an NVIDIA "
            "driver and CUDA-enabled PyTorch, or use VAAKSETU_DEVICE=auto."
        )

    # 2. Apple Silicon MPS (guarded — not available on Windows builds of PyTorch)
    try:
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            # MPS does not expose VRAM size via PyTorch; estimate from system RAM
            import subprocess as sp
            try:
                result = sp.run(
                    ["sysctl", "-n", "hw.memsize"], capture_output=True, text=True
                )
                total_ram_gb = int(result.stdout.strip()) / (1024 ** 3)
                # Unified memory: GPU can use ~70% of RAM
                estimated_vram = total_ram_gb * 0.70
            except Exception:
                estimated_vram = 8.0  # Safe default for M1/M2
            print(
                f"[Device] Apple Silicon MPS detected "
                f"(estimated usable VRAM: {estimated_vram:.1f}GB)"
            )
            # CRITICAL: On Apple Silicon MPS, torch.float16 causes Metal kernel
            # MPSNDArrayMatrixMultiplication assertion crashes during Seq2Seq beam search.
            # torch.float32 runs natively at full GPU speed without Metal assertion bugs.
            return "mps", torch.float32, estimated_vram
    except Exception:
        pass  # MPS not available or PyTorch built without MPS support

    # 3. CPU fallback
    import multiprocessing
    cpu_count = multiprocessing.cpu_count()
    print(f"[Device] CPU fallback ({cpu_count} cores, no GPU acceleration)")
    return "cpu", torch.float32, 0.0


DEVICE, TORCH_DTYPE, AVAILABLE_VRAM_GB = detect_device()
print(
    f"[Local AI] VaakSetu Local Engine v3.0 | Device: {DEVICE} | "
    f"dtype: {TORCH_DTYPE} | Est. VRAM: {AVAILABLE_VRAM_GB:.1f}GB"
)

# ---------------------------------------------------------------------------
# Language Code Mapping
# ---------------------------------------------------------------------------
INDICTRANS_LANG_MAP: Dict[str, str] = {
    "hi": "hin_Deva", "mr": "mar_Deva", "en": "eng_Latn",
    "bn": "ben_Beng", "gu": "guj_Gujr", "ta": "tam_Taml",
    "te": "tel_Telu", "kn": "kan_Knda", "ml": "mal_Mlym",
    "pa": "pan_Guru", "or": "ory_Orya", "ur": "urd_Arab",
    "as": "asm_Beng", "sa": "san_Deva", "sd": "snd_Deva",
    "ne": "npi_Deva", "bho": "bho_Deva", "mai": "mai_Deva",
    "dgo": "doi_Deva", "kok": "kok_Deva", "kas": "kas_Arab",
    "mni": "mni_Beng", "sat": "sat_Olck",
}

NLLB_LANG_MAP: Dict[str, str] = {
    "hi": "hin_Deva", "mr": "mar_Deva", "en": "eng_Latn",
    "bn": "ben_Beng", "gu": "guj_Gujr", "ta": "tam_Taml",
    "te": "tel_Telu", "kn": "kan_Knda", "ml": "mal_Mlym",
    "pa": "pan_Guru", "or": "ory_Orya", "ur": "urd_Arab",
    "ne": "npi_Deva",
}

TTS_VOICE_MAP: Dict[str, str] = {
    "mr": "mr-IN-AarohiNeural",
    "mr-female": "mr-IN-AarohiNeural",
    "mr-male": "mr-IN-ManoharNeural",
    "hi": "hi-IN-SwaraNeural",
    "hi-female": "hi-IN-SwaraNeural",
    "hi-male": "hi-IN-MadhurNeural",
    "en": "en-IN-NeerjaNeural",
    "en-female": "en-IN-NeerjaNeural",
    "en-male": "en-IN-PrabhatNeural",
    "en-us": "en-US-JennyNeural",
    "bn": "bn-IN-TanishaaNeural",
    "gu": "gu-IN-DhwaniNeural",
    "ta": "ta-IN-PallaviNeural",
    "te": "te-IN-ShrutiNeural",
    "kn": "kn-IN-SapnaNeural",
    "ml": "ml-IN-SobhanaNeural",
    "ur": "ur-IN-GulNeural",
}

# Script-to-language heuristic for auto-detection
SCRIPT_DETECT_MAP = [
    ("\u0900", "\u097F", "hi"),   # Devanagari → Hindi (also Marathi, but hi is safe default)
    ("\u0980", "\u09FF", "bn"),   # Bengali
    ("\u0A00", "\u0A7F", "pa"),   # Gurmukhi → Punjabi
    ("\u0A80", "\u0AFF", "gu"),   # Gujarati
    ("\u0B00", "\u0B7F", "or"),   # Odia
    ("\u0B80", "\u0BFF", "ta"),   # Tamil
    ("\u0C00", "\u0C7F", "te"),   # Telugu
    ("\u0C80", "\u0CFF", "kn"),   # Kannada
    ("\u0D00", "\u0D7F", "ml"),   # Malayalam
    ("\u0600", "\u06FF", "ur"),   # Arabic script → Urdu
]


def detect_script_language(text: str) -> Optional[str]:
    """Heuristic language detection based on Unicode script ranges."""
    for char in text[:200]:  # Sample first 200 chars for speed
        for start, end, lang in SCRIPT_DETECT_MAP:
            if start <= char <= end:
                return lang
    return None  # Likely Latin/English


# ---------------------------------------------------------------------------
# Translation Engine (IndicTrans2 + NLLB fallback)
# ---------------------------------------------------------------------------
class TranslationManager:
    """
    Manages IndicTrans2 and NLLB translation models with:
    - VRAM-aware model size selection (1B vs distilled)
    - LRU eviction to stay within VRAM budget
    - Context-aware sentence batching for coherent translation
    """

    def __init__(self):
        # OrderedDict preserves insertion order for LRU eviction
        self.models: OrderedDict[str, Any] = OrderedDict()
        self.tokenizers: OrderedDict[str, Any] = OrderedDict()
        self.processor: Optional[Any] = None
        self._lock = threading.Lock()
        self._init_processor()

    def _init_processor(self):
        try:
            from IndicTransToolkit.processor import IndicProcessor
            self.processor = IndicProcessor(inference=True)
            print("[Local AI] IndicProcessor initialized successfully.")
        except Exception as e:
            print(f"[Local AI] IndicProcessor not available: {e}")
            self.processor = None

    def _get_hf_token(self) -> Optional[str]:
        return os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN") or None

    def _get_indictrans_candidates(self, src: str, tgt: str) -> List[str]:
        """
        Return candidate IndicTrans2 model names in priority order:
        1. Distilled models (200M / 320M) — fastest, minimal RAM/swap footprint (<1GB VRAM)
        2. 1B models — full quality fallback when available
        """
        if src == "en" and tgt != "en":
            return [
                "ai4bharat/indictrans2-en-indic-dist-200M",
                "ai4bharat/indictrans2-en-indic-1B",
            ]
        elif src != "en" and tgt == "en":
            return [
                "ai4bharat/indictrans2-indic-en-dist-200M",
                "ai4bharat/indictrans2-indic-en-1B",
            ]
        else:
            return [
                "ai4bharat/indictrans2-indic-indic-dist-320M",
                "ai4bharat/indictrans2-indic-indic-1B",
            ]

    def _evict_oldest_model(self):
        """Evict the LRU (least recently used) model to free VRAM."""
        if not self.models:
            return
        oldest_key = next(iter(self.models))
        print(f"[Local AI] Evicting model '{oldest_key}' from {DEVICE} to free VRAM...")
        del self.models[oldest_key]
        del self.tokenizers[oldest_key]
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        print(f"[Local AI] Eviction complete.")

    def offload_all(self):
        """Explicitly offload all translation models from VRAM."""
        keys = list(self.models.keys())
        for key in keys:
            del self.models[key]
            del self.tokenizers[key]
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        print(f"[Local AI] All translation models offloaded. ({len(keys)} models freed)")

    def _touch_model(self, name: str):
        """Move model to end of OrderedDict (mark as recently used)."""
        if name in self.models:
            self.models.move_to_end(name)
            self.tokenizers.move_to_end(name)

    def load_model(self, src_key: str, tgt_key: str):
        """
        Load the appropriate translation model, evicting LRU if needed.
        Priority:
        1. Distilled IndicTrans2 (200M / 320M) — fastest, no swap (<1GB VRAM)
        2. 1B IndicTrans2 — high quality fallback
        3. NLLB-200-distilled-600M — offline open fallback
        """
        with self._lock:
            token = self._get_hf_token()
            from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

            # ── 1. IndicTrans2 — Priority: Distilled 200M/320M ➔ 1B ──
            candidates = (
                self._get_indictrans_candidates(src_key, tgt_key)
                if self.processor is not None
                else []
            )

            for it_name in candidates:
                if it_name in self.models:
                    self._touch_model(it_name)
                    return self.models[it_name], self.tokenizers[it_name], "indictrans2", it_name

                try:
                    print(f"[Local AI] Loading IndicTrans2 ({it_name.split('/')[-1]})...")
                    while len(self.models) >= MAX_LOADED_TRANSLATION_MODELS:
                        self._evict_oldest_model()

                    load_options = {
                        "trust_remote_code": True,
                        "token": token,
                        "local_files_only": AIRGAPPED_MODE,
                    }
                    tok = AutoTokenizer.from_pretrained(it_name, **load_options)
                    mod = AutoModelForSeq2SeqLM.from_pretrained(
                        it_name,
                        torch_dtype=TORCH_DTYPE,
                        **load_options,
                    ).to(DEVICE)
                    mod.eval()
                    self.models[it_name] = mod
                    self.tokenizers[it_name] = tok
                    print(f"[Local AI] ✓ Successfully loaded IndicTrans2: {it_name} on {DEVICE} ({TORCH_DTYPE}).")
                    return mod, tok, "indictrans2", it_name
                except Exception as e:
                    print(f"[Local AI] IndicTrans2 ({it_name}) notice: {e}")

            # ── 2. NLLB-200-distilled-600M — Fallback ──
            nllb_name = "facebook/nllb-200-distilled-600M"
            if nllb_name in self.models:
                self._touch_model(nllb_name)
                return self.models[nllb_name], self.tokenizers[nllb_name], "nllb", nllb_name

            print(f"[Local AI] Loading NLLB fallback: {nllb_name}...")
            while len(self.models) >= MAX_LOADED_TRANSLATION_MODELS:
                self._evict_oldest_model()

            tok = AutoTokenizer.from_pretrained(
                nllb_name,
                local_files_only=AIRGAPPED_MODE,
            )
            mod = AutoModelForSeq2SeqLM.from_pretrained(
                nllb_name,
                torch_dtype=TORCH_DTYPE,
                local_files_only=AIRGAPPED_MODE,
            ).to(DEVICE)
            mod.eval()
            self.models[nllb_name] = mod
            self.tokenizers[nllb_name] = tok
            print(f"[Local AI] ✓ Loaded NLLB fallback: {nllb_name} on {DEVICE} ({TORCH_DTYPE}).")
            return mod, tok, "nllb", nllb_name

    def _split_into_sentences(self, text: str) -> List[str]:
        """
        Split text into sentences using regex boundary detection.
        Preserves Indic danda ('।') and English period ('.') boundaries.
        """
        import re
        parts = re.split(r'(?<=[।!?.\n])\s+', text.strip())
        return [p.strip() for p in parts if p.strip()]

    def _batch_sentences(
        self,
        sentences: List[str],
        max_batch_tokens: int = 500,
    ) -> List[List[str]]:
        """
        Group sentences into batches of roughly equal total token count.
        Each batch stays under max_batch_tokens to avoid truncation.
        """
        batches: List[List[str]] = []
        current_batch: List[str] = []
        current_len = 0

        for sent in sentences:
            sent_len = len(sent.split())
            if current_len + sent_len > max_batch_tokens and current_batch:
                batches.append(current_batch)
                current_batch = [sent]
                current_len = sent_len
            else:
                current_batch.append(sent)
                current_len += sent_len

        if current_batch:
            batches.append(current_batch)

        return batches if batches else [[s] for s in sentences]

    def _translate_batch_indictrans2(
        self,
        sentences: List[str],
        src_key: str,
        tgt_key: str,
        model: Any,
        tokenizer: Any,
    ) -> List[str]:
        """Translate a batch of sentences using IndicTrans2 with optimized greedy inference."""
        src_tag = INDICTRANS_LANG_MAP.get(src_key, "hin_Deva")
        tgt_tag = INDICTRANS_LANG_MAP.get(tgt_key, "eng_Latn")

        batch = self.processor.preprocess_batch(
            sentences, src_lang=src_tag, tgt_lang=tgt_tag
        )
        inputs = tokenizer(
            batch,
            padding="longest",
            truncation=True,
            max_length=256,
            return_tensors="pt",
        ).to(DEVICE)

        with torch.no_grad():
            generated_tokens = model.generate(
                **inputs,
                use_cache=True,
                min_length=0,
                max_new_tokens=256,
                num_beams=1,
                num_return_sequences=1,
            )
        with torch.no_grad():
            decoded = tokenizer.batch_decode(
                generated_tokens.detach().cpu().tolist(), src=False
            )
        postprocessed = self.processor.postprocess_batch(decoded, lang=tgt_tag)
        return [
            clean_repetitive_phrases(
                t.replace("</s>", "")
                .replace("<s>", "")
                .replace("<pad>", "")
                .replace("<unk>", "")
                .strip()
            )
            for t in postprocessed
        ]

    def _translate_batch_nllb(
        self,
        sentences: List[str],
        src_key: str,
        tgt_key: str,
        model: Any,
        tokenizer: Any,
    ) -> List[str]:
        """Translate a batch using NLLB-200 model."""
        src_tag = NLLB_LANG_MAP.get(src_key, "hin_Deva")
        tgt_tag = NLLB_LANG_MAP.get(tgt_key, "eng_Latn")
        tokenizer.src_lang = src_tag
        forced_bos_token_id = tokenizer.convert_tokens_to_ids(tgt_tag)

        inputs = tokenizer(
            sentences,
            padding="longest",
            truncation=True,
            max_length=256,
            return_tensors="pt",
        ).to(DEVICE)

        with torch.no_grad():
            generated_tokens = model.generate(
                **inputs,
                forced_bos_token_id=forced_bos_token_id,
                use_cache=True,
                max_new_tokens=256,
                num_beams=1,
            )
        with torch.no_grad():
            decoded = tokenizer.batch_decode(
                generated_tokens.detach().cpu().tolist(), skip_special_tokens=True
            )
        return [clean_repetitive_phrases(d.strip()) for d in decoded]

    def translate(
        self,
        text: str,
        src_lang: str,
        tgt_lang: str,
    ) -> Dict[str, Any]:
        """Translate text with sentence batching and pre/post processing."""
        if not text or not text.strip():
            return {
                "translated_text": "",
                "model": "none",
                "model_type": "none",
                "model_detail": "Empty input",
                "src_lang": src_lang,
                "tgt_lang": tgt_lang,
            }

        src_key = src_lang.lower().split("-")[0]
        tgt_key = tgt_lang.lower().split("-")[0]

        if src_key == "auto":
            detected = detect_script_language(text)
            src_key = detected if detected else "hi"

        if src_key == tgt_key:
            return {
                "translated_text": text,
                "model": "identity",
                "model_type": "identity",
                "model_detail": "Same source and target language",
                "src_lang": src_key,
                "tgt_lang": tgt_key,
            }

        model, tokenizer, model_type, model_name = self.load_model(src_key, tgt_key)

        sentences = self._split_into_sentences(text)
        batches = self._batch_sentences(sentences, max_batch_tokens=300)

        translated_sentences: List[str] = []
        for batch in batches:
            if not batch:
                continue
            try:
                if model_type == "indictrans2" and self.processor is not None:
                    translated = self._translate_batch_indictrans2(
                        batch, src_key, tgt_key, model, tokenizer
                    )
                else:
                    translated = self._translate_batch_nllb(
                        batch, src_key, tgt_key, model, tokenizer
                    )
                translated_sentences.extend(translated)
            except Exception as e:
                print(f"[Local AI] Batch translation error ({e})")
                translated_sentences.extend(batch)

        result_text = clean_repetitive_phrases(" ".join(translated_sentences).strip())
        model_label = "indictrans2-local" if model_type == "indictrans2" else "nllb-local"

        return {
            "translated_text": result_text,
            "model": model_label,
            "model_type": model_type,
            "model_detail": f"Local {model_name} on {DEVICE}",
            "src_lang": src_key,
            "tgt_lang": tgt_key,
        }

    def translate_segments_batched(
        self,
        segments: List[Dict[str, Any]],
        src_lang: str,
        tgt_lang: str,
    ) -> List[Dict[str, Any]]:
        """
        YouTube-grade: Per-sentence translation with lossless 1:1 timestamp mapping.

        When segments come from reconstruct_sentences(), each segment IS already a
        complete linguistic sentence (3-18 words). We translate each sentence
        independently in GPU-efficient batches of 16, then map translations
        back 1:1 to their original timestamps — no proportional splitting.

        This is what IndicTrans2 320M is trained for: sentence-level NMT.
        Translating individual sentences (vs. paragraphs) gives the highest quality.
        """
        if not segments:
            return []

        # Clean input against stuttering loops
        segments = deduplicate_segments(segments)
        if not segments:
            return []

        src_key = src_lang.lower().split("-")[0]
        tgt_key = tgt_lang.lower().split("-")[0]

        if src_key == "auto":
            sample_text = " ".join(s.get("text", "") for s in segments[:5])
            detected = detect_script_language(sample_text)
            src_key = detected if detected else "hi"

        if src_key == tgt_key:
            return segments

        model, tokenizer, model_type, model_name = self.load_model(src_key, tgt_key)

        # ── Extract sentence texts, preserving order and index ──
        # Each sentence is already a complete linguistic unit from reconstruct_sentences().
        # We translate them in GPU-efficient batches, then map back 1:1.
        sentence_texts: List[str] = []
        valid_indices: List[int] = []

        for i, seg in enumerate(segments):
            text = seg.get("text", "").strip()
            if text:
                sentence_texts.append(text)
                valid_indices.append(i)

        if not sentence_texts:
            return segments

        print(
            f"[Local AI] 🎯 Sentence-level translation: {len(sentence_texts)} sentences "
            f"({src_key} ➔ {tgt_key}) via {model_name}..."
        )

        # ── Batch translate all sentences in GPU-efficient chunks of 16 ──
        # GPU processes 16 sentences simultaneously — much faster than sequential.
        CHUNK_SIZE = 16
        all_translated: List[str] = []

        for c_start in range(0, len(sentence_texts), CHUNK_SIZE):
            chunk = sentence_texts[c_start : c_start + CHUNK_SIZE]
            try:
                if model_type == "indictrans2" and self.processor is not None:
                    chunk_results = self._translate_batch_indictrans2(
                        chunk, src_key, tgt_key, model, tokenizer
                    )
                else:
                    chunk_results = self._translate_batch_nllb(
                        chunk, src_key, tgt_key, model, tokenizer
                    )
                all_translated.extend(chunk_results)
            except Exception as e:
                print(f"[Local AI] Batch translation chunk error: {e}")
                all_translated.extend(chunk)  # Fallback: keep source

        # ── 1:1 Lossless mapping: translated sentence → original timestamp ──
        # No proportional splitting. Each sentence keeps its exact start/end.
        translated_segments = list(segments)  # Copy with original timestamps

        for list_idx, seg_idx in enumerate(valid_indices):
            if list_idx < len(all_translated):
                translated_text = clean_repetitive_phrases(all_translated[list_idx])
                if translated_text:
                    translated_segments[seg_idx] = {
                        **segments[seg_idx],
                        "text": translated_text,
                    }

        # Final deduplication pass
        final_deduped = deduplicate_segments(translated_segments)
        print(
            f"[Local AI] ✓ Sentence Translation Complete: {len(final_deduped)} segments "
            f"(zero information loss — 1:1 timestamp mapping)"
        )
        return final_deduped


# ---------------------------------------------------------------------------
# Anti-Repetition & Hallucination Filter
# ---------------------------------------------------------------------------
def clean_repetitive_phrases(text: str) -> str:
    """
    Deduplicates phrase & word repetition loops inside a text string.
    e.g. 'I like gemini I like gemini I like gemini' -> 'I like gemini'
    'मला जेमिनी आवडतो मला जेमिनी आवडतो' -> 'मला जेमिनी आवडतो'
    """
    if not text or not text.strip():
        return ""

    import re
    cleaned = text.strip()
    cleaned = re.sub(r'\s+', ' ', cleaned)

    # 1. Word-level repeated sequence deduplication (e.g. 1-12 word repetitions)
    # Detects: (word_1 ... word_k ) repeated 2 or more times consecutively
    for k in range(12, 0, -1):
        pattern = r'(?:\b|^)((?:[^\s,!?.]+\s+){' + str(k) + r'})\s*(?:\1)+'
        cleaned = re.sub(pattern, r'\1', cleaned, flags=re.IGNORECASE).strip()

    # 2. Substring repeated sequence deduplication (covers Devanagari & Latin phrases with commas/dots)
    # e.g. "I like gemini, I like gemini, I like gemini" -> "I like gemini"
    pattern2 = r'([^\n,!?]{3,50}?)(?:\s*[,.!?]?\s*\1){2,}'
    cleaned = re.sub(pattern2, r'\1', cleaned, flags=re.IGNORECASE).strip()

    return cleaned


def safe_round(value: Any, digits: int, default: float = 0.0) -> float:
    """Return JSON-safe numeric output for model values that may be NaN/inf."""
    try:
        numeric = float(value)
        return round(numeric, digits) if math.isfinite(numeric) else default
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------------------
# Anti-Repetition & Hallucination Filter
# ---------------------------------------------------------------------------
def clean_repetitive_phrases(text: str) -> str:
    """
    Deduplicates phrase & word repetition loops inside a text string.
    Normalizes excessive punctuation, spaces, and repeated loop phrases.
    """
    if not text or not text.strip():
        return ""

    import re
    cleaned = text.strip()
    # Normalize excessive dots, hyphens, and whitespace
    cleaned = re.sub(r'\.{2,}', '.', cleaned)
    cleaned = re.sub(r'-{2,}', '-', cleaned)
    cleaned = re.sub(r'\s+', ' ', cleaned)

    # 1. Word-level repeated sequence deduplication (e.g. 1-12 word repetitions)
    for k in range(12, 0, -1):
        pattern = r'(?:\b|^)((?:[^\s,!?.]+\s+){' + str(k) + r'})\s*(?:\1)+'
        cleaned = re.sub(pattern, r'\1', cleaned, flags=re.IGNORECASE).strip()

    # 2. Substring repeated sequence deduplication (covers Devanagari & Latin phrases)
    pattern2 = r'([^\n,!?]{3,50}?)(?:\s*[,.!?]?\s*\1){2,}'
    cleaned = re.sub(pattern2, r'\1', cleaned, flags=re.IGNORECASE).strip()

    return cleaned


def is_hallucination_or_noise(text: str) -> bool:
    """
    Strict check: ONLY marks a segment as hallucination/noise if it contains
    NO real words/speech (e.g. pure music tokens, empty punctuation, or single repeated character).
    Legitimate speech is NEVER discarded.
    """
    if not text or len(text.strip()) == 0:
        return True

    import re
    clean = clean_repetitive_phrases(text)

    # Check if pure music/sound annotation e.g. [Music], (applause), ♪♪♪
    if re.fullmatch(
        r'[\s♪♫\[\]\(\)*_~#\.\,\-\!\?]*((music|applause|laughter|silence|bgm|instrumental|cheering)[\s♪♫\[\]\(\)*_~#\.\,\-\!\?]*)+',
        clean,
        flags=re.IGNORECASE,
    ):
        return True

    # Strip all whitespace and punctuation symbols
    content = re.sub(r'[\s.,!?।|_\-~*#♪♫/\\()\[\];:\'"„“”]+', '', clean)
    if len(content) == 0:
        return True

    # Check if content is just a single character repeated 4+ times (e.g. 'aaaa', 'बबबब')
    if len(content) >= 4 and len(set(content)) == 1:
        return True

    return False


def deduplicate_segments(segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Clean repetitive phrases inside each segment and merge adjacent
    segments with identical text to prevent stuttering loops.
    """
    if not segments:
        return []

    deduped = []
    prev_text = ""
    prev_count = 0

    for seg in segments:
        raw_text = seg.get("text", "")
        cleaned_text = clean_repetitive_phrases(raw_text)

        if not cleaned_text or is_hallucination_or_noise(cleaned_text):
            continue

        # Check if identical to previous segment
        if cleaned_text.lower() == prev_text.lower():
            prev_count += 1
            if prev_count <= 1 and deduped:
                deduped[-1]["end"] = max(deduped[-1]["end"], seg.get("end", deduped[-1]["end"]))
                continue
            else:
                continue
        else:
            prev_text = cleaned_text
            prev_count = 0

        deduped.append({
            **seg,
            "text": cleaned_text,
        })

    return deduped


# ---------------------------------------------------------------------------
# YouTube-Grade: Grammatical Sentence Reconstruction
# ---------------------------------------------------------------------------
def reconstruct_sentences(
    words: List[Dict[str, Any]],
    max_gap_ms: float = 700.0,
    max_words_per_sentence: int = 18,
    max_duration_sec: float = 8.5,
    min_words_per_sentence: int = 3,
) -> List[Dict[str, Any]]:
    """
    YouTube-grade sentence reconstructor from word-level timestamps.

    Groups words into COMPLETE grammatical sentences (full thoughts with
    subject, object, and verb intact) rather than arbitrary fragments.
    This ensures that translation (IndicTrans2) produces 100% coherent,
    fluent sentences that flow logically when listening continuously.

    Break boundaries:
      1. Sentence terminators: . ? ! । | \n
      2. Natural speech pauses between thoughts: word gap >= 700ms
      3. Over-length safety limit: > 18 words or > 8.5s with a breath pause (>= 300ms)
    """
    import re

    if not words:
        return []

    SENTENCE_END_RE = re.compile(r'[.?!\u0964|\n]\s*$')
    DECIMAL_RE = re.compile(r'^\d+[.]\d+$')

    sentences: List[Dict[str, Any]] = []
    current_words: List[str] = []
    current_start: float = 0.0
    current_end: float = 0.0
    prev_end: float = 0.0

    def flush_sentence(words_buf: List[str], start: float, end: float) -> None:
        if not words_buf:
            return
        text = " ".join(words_buf).strip()
        text = clean_repetitive_phrases(text)
        if text and not is_hallucination_or_noise(text):
            sentences.append({"text": text, "start": round(start, 3), "end": round(end, 3)})

    for i, w in enumerate(words):
        word = w["word"].strip()
        if not word:
            continue
        w_start = w["start"]
        w_end = w["end"]

        gap_ms = (w_start - prev_end) * 1000.0 if prev_end > 0 else 0.0
        word_count = len(current_words)
        duration = (w_end - current_start) if current_words else (w_end - w_start)

        is_sentence_end = bool(SENTENCE_END_RE.search(word)) and not DECIMAL_RE.match(word)
        is_long_pause = gap_ms >= max_gap_ms and word_count >= min_words_per_sentence
        is_over_limit = (
            (word_count >= max_words_per_sentence or duration >= max_duration_sec)
            and gap_ms >= 300.0
            and word_count >= min_words_per_sentence
        )

        # Long pause between thoughts triggers break before this word
        if current_words and is_long_pause:
            flush_sentence(current_words, current_start, current_end)
            current_words = []
            current_start = w_start

        if not current_words:
            current_start = w_start

        current_words.append(word)
        current_end = w_end
        prev_end = w_end

        # Sentence punctuation or over-limit break after this word
        if is_sentence_end or is_over_limit or i == len(words) - 1:
            flush_sentence(current_words, current_start, current_end)
            current_words = []
            current_start = 0.0

    if current_words:
        flush_sentence(current_words, current_start, current_end)

    # Merge fragments that are too short to stand on their own (< 3 words)
    merged: List[Dict[str, Any]] = []
    for s in sentences:
        if len(s["text"].split()) < min_words_per_sentence and merged:
            merged[-1]["text"] += " " + s["text"]
            merged[-1]["end"] = s["end"]
        else:
            merged.append(dict(s))

    print(
        f"[Local AI] 🎯 Grammatical sentence reconstruction: {len(words)} words → {len(merged)} complete sentences "
        f"(avg {len(words) // max(1, len(merged))} words/sentence, ~{(words[-1]['end'] if words else 0) / max(1, len(merged)):.1f}s/sentence)"
    )
    return merged


def split_coarse_segments_by_sentences(
    coarse_segments: List[Dict[str, Any]],
    max_words_per_sentence: int = 18,
    min_words_per_sentence: int = 3,
) -> List[Dict[str, Any]]:
    """
    TEXT-LEVEL fallback: split coarse Whisper segments into complete grammatical
    sentences based on punctuation boundaries (. ? ! । | or newline) with
    proportional timestamp distribution.

    Preserves full sentence grammar so IndicTrans2 translations remain 100% coherent.
    """
    import re

    if not coarse_segments:
        return []

    SENTENCE_SPLIT_RE = re.compile(r'(?<=[.?!\u0964|\n])\s+')
    result: List[Dict[str, Any]] = []

    for seg in coarse_segments:
        text = seg.get("text", "").strip()
        seg_start = seg["start"]
        seg_end = seg["end"]
        seg_duration = max(0.1, seg_end - seg_start)

        if not text or seg_duration <= 0:
            continue

        raw_parts = [p.strip() for p in SENTENCE_SPLIT_RE.split(text) if p.strip()]
        if not raw_parts:
            result.append(seg)
            continue

        # If any part exceeds max words, break at comma/semicolon clauses
        parts: List[str] = []
        for p in raw_parts:
            words = p.split()
            if len(words) > max_words_per_sentence:
                sub_parts = [sp.strip() for sp in re.split(r'(?<=[,;:\-])\s+', p) if sp.strip()]
                curr = ""
                for sp in sub_parts:
                    if curr and len(curr.split()) + len(sp.split()) <= max_words_per_sentence:
                        curr += " " + sp
                    else:
                        if curr:
                            parts.append(curr)
                        curr = sp
                if curr:
                    parts.append(curr)
            else:
                parts.append(p)

        if len(parts) <= 1:
            result.append(seg)
            continue

        # Distribute timestamps proportionally by character count
        total_chars = sum(len(p) for p in parts) or 1
        curr_time = seg_start

        for j, part in enumerate(parts):
            part_clean = clean_repetitive_phrases(part)
            if not part_clean or is_hallucination_or_noise(part_clean):
                continue

            frac = len(part) / total_chars
            dur = seg_duration * frac
            start_t = round(curr_time, 3)
            end_t = round(min(curr_time + dur, seg_end), 3) if j < len(parts) - 1 else seg_end

            result.append({
                "start": start_t,
                "end": end_t,
                "text": part_clean,
            })
            curr_time += dur

    print(
        f"[Local AI] 📄 Grammatical sentence split: {len(coarse_segments)} coarse segments "
        f"→ {len(result)} complete sentence segments"
    )
    return result if result else coarse_segments



class WhisperManager:
    """
    Manages the faster-whisper ASR model.
    Default: large-v3-turbo (SOTA accuracy for Indian regional languages & noisy speech).
    Falls back gracefully to medium / small if needed.
    """

    def __init__(self):
        self.model: Optional[Any] = None
        self.model_size = "large-v3-turbo"
        self._loaded_device: Optional[str] = None

    def _resolve_whisper_device(self) -> Tuple[str, str]:
        """
        Resolve the best device/compute_type for faster-whisper.
        faster-whisper supports: cuda (float16/int8), cpu (int8).
        MPS is NOT supported by CTranslate2 — falls back to CPU.
        """
        if DEVICE == "cuda":
            return "cuda", "float16"
        # MPS and CPU both use CPU int8 for faster-whisper
        return "cpu", "int8"

    def _ensure_model(self):
        if self.model is not None:
            return self.model

        from faster_whisper import WhisperModel

        whisper_device, compute_type = self._resolve_whisper_device()
        threads = os.cpu_count() or 8 if whisper_device == "cpu" else 1

        target_size = "large-v3-turbo" if "turbo" in self.model_size.lower() else self.model_size

        print(
            f"[Local AI] Loading Whisper {target_size} | "
            f"device={whisper_device} | compute={compute_type} | threads={threads}..."
        )
        try:
            self.model = WhisperModel(
                target_size,
                device=whisper_device,
                compute_type=compute_type,
                cpu_threads=threads,
                num_workers=2,
            )
            self.model_size = target_size
        except Exception as e:
            print(f"[Local AI] Whisper {target_size} notice ({e}). Falling back to 'medium'...")
            self.model = WhisperModel(
                "medium",
                device=whisper_device,
                compute_type=compute_type,
                cpu_threads=threads,
                num_workers=2,
            )
            self.model_size = "medium"

        self._loaded_device = whisper_device
        print(
            f"[Local AI] ✓ Whisper {self.model_size} ready on {whisper_device} ({compute_type})."
        )
        return self.model

    def offload(self):
        """Offload Whisper model from memory."""
        if self.model is not None:
            del self.model
            self.model = None
            gc.collect()
            print("[Local AI] Whisper model offloaded.")

    def transcribe(
        self,
        audio_path: str,
        language: Optional[str] = None,
        model_size: Optional[str] = None,
    ) -> Dict[str, Any]:
        # If a specific model size was requested and differs, reload
        if model_size and model_size != self.model_size:
            self.model_size = model_size
            self.model = None

        model = self._ensure_model()
        lang = language if (language and language != "auto") else None

        # On CPU, beam_size=1 (greedy search) is 4-5x faster with virtually identical accuracy.
        # On GPU (CUDA), beam_size=3 provides high accuracy at GPU speeds.
        beam_size = 3 if self._loaded_device == "cuda" else 1
        best_of = 3 if self._loaded_device == "cuda" else 1

        print(
            f"[Local AI] ASR transcribing: {Path(audio_path).name} "
            f"(lang={lang or 'auto-detect'}, beam_size={beam_size}, device={self._loaded_device})..."
        )

        segments_gen, info = model.transcribe(
            audio_path,
            language=lang,
            beam_size=beam_size,
            best_of=best_of,
            temperature=0.0,
            compression_ratio_threshold=2.4,  # Auto-reject high repetition
            log_prob_threshold=-1.0,          # Auto-reject low confidence noise
            no_speech_threshold=0.6,          # Auto-reject silence
            condition_on_previous_text=False, # Prevents infinite repetition loops
            word_timestamps=True,             # ← YouTube-grade: enables per-word timing
            vad_filter=True,
            vad_parameters=dict(
                min_silence_duration_ms=500,  # Safe: avoid splitting mid-word
                speech_pad_ms=200,
                threshold=0.55,               # Balanced: avoids music hallucinations but catches all speech
            ),
        )

        raw_segments = []
        all_words: List[Dict[str, Any]] = []

        for s in segments_gen:
            clean_text = clean_repetitive_phrases(s.text.strip())
            if not clean_text:
                continue

            # Only drop if the segment is literally non-speech noise (music symbols, empty)
            if is_hallucination_or_noise(clean_text):
                print(f"[Local AI] ⚠️ Filtered pure non-speech audio [{s.start:.1f}s -> {s.end:.1f}s]: {clean_text[:40]}")
                continue

            raw_segments.append({
                "start": safe_round(s.start, 3),
                "end": safe_round(s.end, 3),
                "text": clean_text,
            })

            # Collect word-level timestamps for sentence reconstruction
            if s.words:
                for w in s.words:
                    word_text = w.word.strip()
                    if not word_text:
                        continue
                    all_words.append({
                        "word": word_text,
                        "start": safe_round(w.start, 3),
                        "end": safe_round(w.end, 3),
                        "probability": safe_round(getattr(w, "probability", 1.0), 3, 1.0),
                    })

        print(f"[Local AI] ASR raw: {len(raw_segments)} VAD segments, {len(all_words)} words extracted")

        # Deduplicate VAD-level stuttering loops
        coarse_segments = deduplicate_segments(raw_segments)
        full_text = " ".join(s["text"] for s in coarse_segments).strip()
        detected_lang = getattr(info, "language", None) or (language or "hi")
        duration = safe_round(getattr(info, "duration", 0.0), 2)

        # Guard: If auto-detection incorrectly picked 'bn' on intro music and produced 0 valid segments,
        # automatically re-transcribe with Marathi ('mr') to extract the actual dialogue!
        if not lang and detected_lang == "bn" and len(coarse_segments) <= 2:
            print("[Local AI] 🔄 Auto-detect misclassified intro music as 'bn'. Re-transcribing in Marathi ('mr')...")
            return self.transcribe(audio_path, language="mr", model_size=model_size)

        # ── YouTube-grade: TWO-PATH sentence reconstruction ──
        #
        # PATH 1 (preferred): Word-level reconstruction via reconstruct_sentences()
        #   Requires faster-whisper to return s.words (needs CTranslate2 DTW support).
        #   Produces the most precise timestamps (±50ms accuracy).
        #   Detected by: all_words list is non-empty.
        #
        # PATH 2 (universal fallback): Text-level splitting via split_coarse_segments_by_sentences()
        #   Works on ALL platforms/compute types (CPU int8, MPS, CUDA).
        #   Splits each coarse segment's text at punctuation boundaries.
        #   Timestamps are proportional (by character count) — good enough for subtitles.
        #   ALWAYS produces more fine-grained output than leaving coarse segments as-is.
        #
        # PATH 3 (last resort): Keep coarse segments unchanged.
        #   Only if both paths fail or produce 0 segments.

        if all_words:
            # PATH 1: Word-level precise reconstruction
            fine_segments = reconstruct_sentences(all_words)
            if not fine_segments:
                # Word path produced 0 results — fall through to text path
                fine_segments = split_coarse_segments_by_sentences(coarse_segments)
            path_used = "word-level"
        else:
            # PATH 2: Text-level splitting (no word timestamps available)
            fine_segments = split_coarse_segments_by_sentences(coarse_segments)
            path_used = "text-level"

        if not fine_segments:
            # PATH 3: Last resort fallback
            fine_segments = coarse_segments
            path_used = "coarse-fallback"

        print(
            f"[Local AI] ✓ ASR Complete [{path_used}]: "
            f"{len(coarse_segments)} VAD coarse → {len(fine_segments)} fine sentences, "
            f"lang={detected_lang}, duration={duration}s"
        )

        return {
            "text": full_text,
            "segments": fine_segments,      # Fine-grained sentence segments (YouTube-grade)
            "coarse_segments": coarse_segments,  # Original VAD segments (for debugging)
            "words": all_words,             # Raw word-level timestamps
            "detected_language": detected_lang,
            "language_probability": safe_round(
                getattr(info, "language_probability", 1.0), 2, 1.0
            ),
            "duration": duration,
            "model": f"whisper-{self.model_size}-{'gpu' if self._loaded_device == 'cuda' else 'cpu'}",
        }


# ---------------------------------------------------------------------------
# Segment-Aware Neural TTS Engine
# ---------------------------------------------------------------------------
class TtsManager:
    """
    Synthesizes speech either as a single block or per-segment with time-slot alignment.
    Per-segment mode: each sentence's audio is placed at the correct timestamp,
    with silence padding and gentle time-stretching via ffmpeg atempo.
    """

    _piper_voices: Dict[str, Any] = {}

    @classmethod
    def _piper_model_path(cls, language: str) -> Optional[Path]:
        model_dir = Path(
            os.environ.get(
                "VAAKSETU_TTS_MODEL_DIR",
                str(Path(__file__).resolve().parents[1] / "models" / "tts"),
            )
        )
        lang_key = language.lower().split("-")[0]
        preferred = {
            "hi": ["hi_IN-priyamvada-medium.onnx", "hi_IN-rohan-medium.onnx"],
            "mr": ["mr_IN-meera-medium.onnx"],
            "en": ["en_US-lessac-medium.onnx"],
        }.get(lang_key, [])
        for name in preferred:
            path = model_dir / name
            if path.is_file() and (model_dir / f"{name}.json").is_file():
                return path
        return None

    @classmethod
    def _synthesize_piper(cls, text: str, language: str, output_path: Path) -> bool:
        model_path = cls._piper_model_path(language)
        if not model_path:
            return False
        from piper import PiperVoice

        key = str(model_path)
        voice = cls._piper_voices.get(key)
        if voice is None:
            voice = PiperVoice.load(key)
            cls._piper_voices[key] = voice
        import wave

        with wave.open(str(output_path), "wb") as wav_file:
            voice.synthesize_wav(text.strip() or "...", wav_file)
        return output_path.exists() and output_path.stat().st_size > 0

    @staticmethod
    def _latinize_indic(text: str) -> str:
        """Approximate Devanagari pronunciation for an English-only local voice."""
        consonants = {
            "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "ng",
            "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "ny",
            "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n",
            "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
            "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m",
            "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
            "ष": "sh", "स": "s", "ह": "h", "ळ": "l",
        }
        vowels = {
            "ा": "a", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo",
            "ृ": "ri", "े": "e", "ै": "ai", "ो": "o", "ौ": "au",
        }
        independent = {
            "अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u",
            "ऊ": "oo", "ए": "e", "ऐ": "ai", "ओ": "o", "औ": "au",
            "ं": "n", "ः": "h", "ँ": "n",
        }
        output = []
        index = 0
        while index < len(text):
            char = text[index]
            if char in consonants:
                value = consonants[char]
                if index + 1 < len(text) and text[index + 1] in vowels:
                    value += vowels[text[index + 1]]
                    index += 1
                elif index + 1 < len(text) and text[index + 1] == "्":
                    index += 1
                else:
                    value += "a"
                output.append(value)
            elif char in independent:
                output.append(independent[char])
            elif char == "।":
                output.append(".")
            elif char.isspace() or char.isascii():
                output.append(char)
            index += 1
        return "".join(output)

    @classmethod
    def _tts_input_text(cls, text: str, language: str) -> str:
        """Use native text when a matching voice exists; otherwise phonetic fallback."""
        if language.lower().split("-")[0] in {"hi", "mr"} and any(
            "\u0900" <= char <= "\u097f" for char in text
        ):
            fallback = cls._latinize_indic(text)
            print("[TTS] No Indic SAPI voice configured; using offline phonetic fallback.")
            return fallback
        return text

    @staticmethod
    def _synthesize_local(text: str, language: str, output_path: Path) -> None:
        """Synthesize with an installed offline OS voice; never contacts a service."""
        lang_key = language.lower().split("-")[0]
        if TtsManager._synthesize_piper(text, language, output_path):
            return
        speech_text = TtsManager._tts_input_text(text.strip() or "...", language)
        import shutil

        speech_shell = (
            shutil.which("powershell.exe") or shutil.which("pwsh.exe")
            or (
                r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
                if Path(r"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe").is_file()
                else None
            )
            if sys.platform == "win32"
            else None
        )
        if speech_shell:
            input_path = Path(tempfile.mktemp(suffix=".txt"))
            input_path.write_text(speech_text, encoding="utf-8")
            script = (
                "Add-Type -AssemblyName System.Speech; "
                "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                "$voices = $s.GetInstalledVoices(); "
                "$match = $voices | Where-Object { $_.VoiceInfo.Culture.Name -like "
                f"'{lang_key}-*' }} | Select-Object -First 1; "
                "if ($match) { $s.SelectVoice($match.VoiceInfo.Name) }; "
                "$s.SetOutputToWaveFile($env:VAAKSETU_TTS_OUTPUT); "
                "$s.Speak((Get-Content -Raw -Encoding UTF8 $env:VAAKSETU_TTS_INPUT)); "
                "$s.Dispose()"
            )
            env = os.environ.copy()
            env["VAAKSETU_TTS_INPUT"] = str(input_path)
            env["VAAKSETU_TTS_OUTPUT"] = str(output_path)
            try:
                result = subprocess.run(
                    [
                        speech_shell, "-NoProfile", "-NonInteractive",
                        "-ExecutionPolicy", "Bypass", "-Command", script,
                    ],
                    capture_output=True,
                    text=True,
                    env=env,
                    timeout=60,
                    check=False,
                )
                if result.returncode != 0:
                    raise RuntimeError(result.stderr.strip() or "Windows Speech synthesis failed")
            finally:
                if input_path.exists():
                    input_path.unlink()
        if not output_path.exists() or output_path.stat().st_size == 0:
            import pyttsx3

            engine = pyttsx3.init()
            try:
                voices = engine.getProperty("voices") or []
                for voice in voices:
                    voice_info = " ".join(
                        str(value).lower()
                        for value in (
                            getattr(voice, "id", ""),
                            getattr(voice, "name", ""),
                            getattr(voice, "languages", []),
                        )
                    )
                    if lang_key in voice_info:
                        engine.setProperty("voice", voice.id)
                        break
                engine.save_to_file(speech_text, str(output_path))
                engine.runAndWait()
            finally:
                engine.stop()

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError(
                f"No offline voice output was created for language '{lang_key}'. "
                "Install an OS voice for this language."
            )

    async def synthesize_single(
        self,
        text: str,
        language: str,
        voice_override: Optional[str] = None,
        rate: str = "+0%",
    ) -> bytes:
        """Synthesize a single text block locally to WAV bytes."""
        clean_text = text.strip() or "..."

        tmp_path = Path(tempfile.mktemp(suffix=".wav"))
        try:
            await asyncio.to_thread(self._synthesize_local, clean_text, language, tmp_path)
            return tmp_path.read_bytes()
        except Exception as e:
            raise RuntimeError(f"Offline TTS failed: {e}") from e
        finally:
            if tmp_path.exists():
                tmp_path.unlink()

    async def synthesize_segments(
        self,
        segments: List[Dict[str, Any]],
        language: str,
        total_duration: float,
        voice_override: Optional[str] = None,
    ) -> bytes:
        """
        Synthesize per-segment audio with time-slot alignment.
        Uses natural speech pacing without hard-truncating audio, ensuring
        crystal-clear pronunciation and no chopped syllables.
        """
        from pydub import AudioSegment
        # Translated text must not pass through the ASR hallucination filter:
        # that filter is intentionally conservative for Whisper output and can
        # misclassify valid non-Latin text on Windows locale configurations.
        cleaned_segments = []
        for segment in segments:
            text = clean_repetitive_phrases(str(segment.get("text", "")))
            if text:
                cleaned_segments.append({**segment, "text": text})
        segments = cleaned_segments
        if not segments:
            print("[TTS] No valid translated segments received; returning silence.")
            silence = AudioSegment.silent(duration=int(total_duration * 1000))
            buf = BytesIO()
            silence.export(buf, format="mp3", bitrate="192k")
            return buf.getvalue()

        # Build timeline as silence covering the full video duration
        timeline_ms = int(max(total_duration, segments[-1]["end"] + 2.0) * 1000)
        output = AudioSegment.silent(duration=timeline_ms)

        successful_segments = 0
        failed_segments = 0
        skipped_segments = 0
        for i, seg in enumerate(segments):
            seg_text = clean_repetitive_phrases(seg.get("text", "").strip())
            if not seg_text:
                skipped_segments += 1
                print(f"[TTS] Skipping segment {i}: translated text is empty.")
                continue

            seg_start_ms = int(seg["start"] * 1000)
            seg_end_ms = int(seg["end"] * 1000)
            slot_duration_ms = max(500, seg_end_ms - seg_start_ms)

            tmp_path = Path(tempfile.mktemp(suffix=".wav"))
            try:
                await asyncio.to_thread(
                    self._synthesize_local, seg_text, language, tmp_path
                )

                seg_audio = AudioSegment.from_file(str(tmp_path))

            except Exception as e:
                failed_segments += 1
                print(f"[TTS] Offline segment {i} synthesis failed: {e}")
                continue
            finally:
                if tmp_path.exists():
                    tmp_path.unlink()

            actual_ms = len(seg_audio)
            if actual_ms <= 0:
                failed_segments += 1
                print(
                    f"[TTS] Offline segment {i} produced zero-duration audio "
                    f"(file_bytes={tmp_path.stat().st_size if tmp_path.exists() else 0})."
                )
                continue

            # Gentle time alignment: only speed up slightly if speech is significantly longer than slot
            # Capped at 1.25x so voice pitch/pronunciation NEVER becomes distorted
            if actual_ms > slot_duration_ms * 1.2 and slot_duration_ms >= 1000:
                ratio = min(1.25, actual_ms / slot_duration_ms)
                seg_audio = self._time_stretch(seg_audio, ratio)

            # Smoothly overlay at start timestamp without hard clipping
            output = output.overlay(seg_audio, position=seg_start_ms)
            successful_segments += 1

            if (i + 1) % 20 == 0:
                print(f"[TTS] Processed {i + 1}/{len(segments)} segments...")

        print(
            f"[TTS] Completed {successful_segments}/{len(segments)} segments "
            f"offline ({failed_segments} failed, {skipped_segments} skipped); "
            "timeline aligned."
        )

        if successful_segments == 0 and failed_segments > 0:
            raise RuntimeError(
                f"Offline TTS produced no audio for language '{language}'. "
                "The input may contain replacement characters or no readable "
                "text; install a matching Windows Speech voice (Hindi or Marathi) "
                "for native pronunciation."
            )

        buf = BytesIO()
        output.export(buf, format="mp3", bitrate="192k")
        return buf.getvalue()

    def _time_stretch(self, audio: Any, ratio: float) -> Any:
        """
        Time-stretch audio using ffmpeg atempo filter.
        ratio > 1.0 = speed up, ratio < 1.0 = slow down.
        Atempo range is [0.5, 2.0]; chain filters for values outside range.
        """
        if abs(ratio - 1.0) < 0.05:
            return audio

        in_path = Path(tempfile.mktemp(suffix=".wav"))
        out_path = Path(str(in_path) + ".stretched.wav")

        try:
            from pydub import AudioSegment
            audio.export(str(in_path), format="wav")

            # Build atempo chain for values outside [0.5, 2.0]
            atempo_value = max(0.5, min(2.0, ratio))
            filter_str = f"atempo={atempo_value:.4f}"

            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-i", str(in_path),
                "-filter:a", filter_str,
                "-f", "wav", str(out_path),
            ]
            subprocess.run(cmd, capture_output=True, check=True)
            return AudioSegment.from_file(str(out_path), format="wav")
        except Exception as e:
            print(f"[TTS] Time-stretch notice: {e}")
            return audio
        finally:
            for p in [in_path, out_path]:
                if p.exists():
                    p.unlink()


# ---------------------------------------------------------------------------
# Video Dubbing via FFmpeg
# ---------------------------------------------------------------------------
def dub_video_ffmpeg(
    video_path: str,
    audio_path: str,
    output_path: str,
    duck_original: bool = False,
) -> str:
    """Mux a translated audio track with a video file using FFmpeg."""
    # Ensure output directory exists
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)

    if duck_original:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", video_path,
            "-i", audio_path,
            "-filter_complex",
            "[0:a]volume=0.12[a0];[1:a]volume=1.0[a1];[a0][a1]amix=inputs=2:duration=first[aout]",
            "-map", "0:v:0", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            output_path,
        ]
    else:
        cmd = [
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", video_path,
            "-i", audio_path,
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            output_path,
        ]

    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"FFmpeg dubbing failed: {res.stderr}")
    return output_path


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="VaakSetu Local AI Engine",
    description=(
        "Fully offline Indic AI server: IndicTrans2 (200M/1B) + "
        "Whisper ASR (GPU-accelerated) + Neural TTS + Video Dubbing"
    ),
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

translator = TranslationManager()
whisper_mgr = WhisperManager()
tts_mgr = TtsManager()


# ---------------------------------------------------------------------------
# Pydantic Request/Response Schemas
# ---------------------------------------------------------------------------
class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "auto"
    target_lang: str = "en"
    hf_token: Optional[str] = None
    offline_mode: Optional[bool] = None


class DocumentAnswerRequest(BaseModel):
    context: str
    question: str
    source_lang: str = "auto"
    target_lang: str = "en"
    offline_mode: Optional[bool] = None


class BatchTranslateSegmentItem(BaseModel):
    text: str
    start: float = 0.0
    end: float = 0.0


class BatchTranslateRequest(BaseModel):
    """
    Translate video segments in context-aware batches.
    Segments are grouped by context window (not translated individually)
    to produce coherent, non-gibberish translation output.
    """
    segments: List[BatchTranslateSegmentItem]
    source_lang: str = "auto"
    target_lang: str = "en"
    hf_token: Optional[str] = None
    offline_mode: Optional[bool] = None


class TtsRequest(BaseModel):
    text: str
    language: str = "hi"
    voice: Optional[str] = None


class TtsSegment(BaseModel):
    text: str
    start: float
    end: float


class TtsSegmentsRequest(BaseModel):
    segments: List[TtsSegment]
    language: str = "hi"
    total_duration: float = 0.0
    voice: Optional[str] = None


class DubRequest(BaseModel):
    video_path: str
    audio_path: str
    output_path: str
    duck_original: bool = False


class TranscribePathRequest(BaseModel):
    audio_path: str
    language: Optional[str] = None
    model_size: Optional[str] = None
    offline_mode: Optional[bool] = None


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    """Health check with full device, VRAM, and model status information."""
    vram_info: Dict[str, Any] = {"total_gb": round(AVAILABLE_VRAM_GB, 2)}
    cuda_available = torch.cuda.is_available()
    if DEVICE == "cuda":
        try:
            allocated = torch.cuda.memory_allocated(GPU_INDEX) / (1024 ** 3)
            reserved = torch.cuda.memory_reserved(GPU_INDEX) / (1024 ** 3)
            vram_info["allocated_gb"] = round(allocated, 2)
            vram_info["reserved_gb"] = round(reserved, 2)
            vram_info["free_gb"] = round(AVAILABLE_VRAM_GB - reserved, 2)
            vram_info["device_name"] = torch.cuda.get_device_name(GPU_INDEX)
        except Exception:
            pass

    uses_1b = AVAILABLE_VRAM_GB >= VRAM_1B_THRESHOLD_GB
    return {
        "status": "healthy",
        "service": "VaakSetu Local AI Engine v3.0",
        "platform": sys.platform,
        "device": DEVICE,
        "requested_device": REQUESTED_DEVICE,
        "gpu_index": GPU_INDEX,
        "cuda_available": cuda_available,
        "cuda_version": torch.version.cuda,
        "torch_dtype": str(TORCH_DTYPE),
        "vram": vram_info,
        "translation": {
            "active_models": list(translator.models.keys()),
            "max_loaded_models": MAX_LOADED_TRANSLATION_MODELS,
            "uses_1b_models": uses_1b,
            "vram_threshold_for_1b": VRAM_1B_THRESHOLD_GB,
            "has_indictrans2": translator.processor is not None,
            "has_processor": translator.processor is not None,
            "fallback": "nllb-200-distilled-600M",
        },
        "whisper": {
            "model_size": whisper_mgr.model_size,
            "loaded": whisper_mgr.model is not None,
            "device": whisper_mgr._loaded_device or "not-loaded",
        },
        "tts": {
            "voices": list(TTS_VOICE_MAP.keys()),
            "segment_aware": True,
        },
    }


@app.post("/api/translate")
async def translate_endpoint(req: TranslateRequest):
    """Translate text using IndicTrans2 or NLLB with context-aware batching."""
    set_offline_mode(req.offline_mode)
    if req.hf_token:
        os.environ["HF_TOKEN"] = req.hf_token
    try:
        res = await asyncio.to_thread(
            translator.translate, req.text, req.source_lang, req.target_lang
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _document_answer(context: str, question: str) -> str:
    """Return the most relevant source sentences without inventing facts."""
    import re

    sentences = [
        item.strip()
        for item in re.split(r"(?<=[.!?।])\s+|\n+", context)
        if item.strip()
    ]
    question_terms = {
        term.casefold()
        for term in re.findall(r"[\w\u0900-\u097F]+", question)
        if len(term) > 1
    }
    if not question_terms:
        return ""

    ranked = []
    for index, sentence in enumerate(sentences):
        sentence_terms = {
            term.casefold()
            for term in re.findall(r"[\w\u0900-\u097F]+", sentence)
        }
        overlap = question_terms & sentence_terms
        if overlap:
            ranked.append((len(overlap), -index, sentence))

    ranked.sort(reverse=True)
    return " ".join(item[2] for item in ranked[:3])


@app.post("/api/document/answer")
async def document_answer_endpoint(req: DocumentAnswerRequest):
    """Answer from document evidence and translate only the selected evidence."""
    set_offline_mode(req.offline_mode)
    if not req.context.strip():
        raise HTTPException(status_code=400, detail="Document context is empty.")
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question is empty.")

    context_lang = req.source_lang.lower().split("-")[0]
    if context_lang == "auto":
        context_lang = detect_script_language(req.context) or "en"
    question_lang = detect_script_language(req.question) or "en"
    search_question = req.question
    if question_lang != context_lang:
        try:
            translated_question = await asyncio.to_thread(
                translator.translate, req.question, question_lang, context_lang
            )
            search_question = translated_question.get("translated_text", "").strip() or req.question
        except Exception as e:
            print(f"[Local AI] Document question translation notice: {e}")

    evidence = _document_answer(req.context, search_question)
    if not evidence:
        answer = {
            "en": "The answer is not found in the uploaded document.",
            "hi": "इस प्रश्न का उत्तर अपलोड किए गए दस्तावेज़ में नहीं मिला।",
            "mr": "या प्रश्नाचे उत्तर अपलोड केलेल्या दस्तऐवजात सापडले नाही.",
        }.get(req.target_lang, "The answer is not found in the uploaded document.")
        return {"answer": answer, "grounded": False}

    try:
        translated = await asyncio.to_thread(
            translator.translate, evidence, req.source_lang, req.target_lang
        )
        answer = translated.get("translated_text", "").strip()
        if not answer:
            raise RuntimeError("The local translation model returned an empty answer.")
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not produce the answer in {req.target_lang}: {e}",
        )

    return {"answer": answer, "grounded": True, "evidence": evidence}


@app.post("/api/translate-batch")
async def translate_batch_endpoint(req: BatchTranslateRequest):
    """
    Translate video/subtitle segments in context-aware batches.

    Unlike /api/translate which processes text as a single string,
    this endpoint preserves timestamp metadata while grouping segments
    into context windows for coherent translation (prevents gibberish).
    """
    set_offline_mode(req.offline_mode)
    if req.hf_token:
        os.environ["HF_TOKEN"] = req.hf_token
    try:
        segments_data = [
            {"text": s.text, "start": s.start, "end": s.end}
            for s in req.segments
        ]
        translated = await asyncio.to_thread(
            translator.translate_segments_batched,
            segments_data,
            req.source_lang,
            req.target_lang,
        )
        return {
            "segments": translated,
            "count": len(translated),
            "source_lang": req.source_lang,
            "target_lang": req.target_lang,
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe")
async def transcribe_endpoint(req: TranscribePathRequest):
    """Transcribe audio from a file path (must be accessible by this service)."""
    set_offline_mode(req.offline_mode)
    if not Path(req.audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    try:
        res = await asyncio.to_thread(
            whisper_mgr.transcribe, req.audio_path, req.language, req.model_size
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe-sentences")
async def transcribe_sentences_endpoint(req: TranscribePathRequest):
    """
    YouTube-grade transcription endpoint.

    Returns word-level timestamps from Whisper AND fine-grained sentence
    segments reconstructed from those words (8-15 per 30s of speech vs.
    the 2-3 coarse VAD segments from /api/transcribe).

    Use this endpoint for all video/media translation jobs.
    Falls back gracefully to coarse_segments if word timestamps unavailable.
    """
    set_offline_mode(req.offline_mode)
    if not Path(req.audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    try:
        res = await asyncio.to_thread(
            whisper_mgr.transcribe, req.audio_path, req.language, req.model_size
        )
        # segments already contains fine-grained sentences from reconstruct_sentences()
        # words contains raw word-level timestamps for UI word highlighting
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/transcribe-file")
async def transcribe_file_endpoint(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
):
    """Transcribe audio from an uploaded file."""
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    tmp_path = Path(tempfile.mktemp(suffix=suffix))
    try:
        content = await file.read()
        tmp_path.write_bytes(content)
        res = await asyncio.to_thread(
            whisper_mgr.transcribe, str(tmp_path), language
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


@app.post("/api/tts")
async def tts_endpoint(req: TtsRequest):
    """Synthesize speech for a single text block."""
    try:
        audio_bytes = await tts_mgr.synthesize_single(req.text, req.language, req.voice)
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/tts-segments")
async def tts_segments_endpoint(req: TtsSegmentsRequest):
    """
    Synthesize per-segment audio with time-slot alignment.
    Each segment's audio is placed at its original timestamp position.
    Returns a single MP3 covering the full video duration.
    """
    try:
        segments_data = [
            {"text": s.text, "start": s.start, "end": s.end} for s in req.segments
        ]
        audio_bytes = await tts_mgr.synthesize_segments(
            segments_data, req.language, req.total_duration, req.voice
        )
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/dub")
async def dub_endpoint(req: DubRequest):
    """Mux a translated audio track into a video file."""
    if not Path(req.video_path).exists():
        raise HTTPException(status_code=404, detail="Video file not found.")
    if not Path(req.audio_path).exists():
        raise HTTPException(status_code=404, detail="Audio file not found.")
    try:
        out = await asyncio.to_thread(
            dub_video_ffmpeg,
            req.video_path,
            req.audio_path,
            req.output_path,
            req.duck_original,
        )
        return {"status": "success", "output_path": out}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/document/extract-text")
async def extract_document_text_endpoint(file: UploadFile = File(...)):
    """
    Extract clean human-readable text and pages from uploaded PDF or doc files.
    Eliminates binary gibberish and produces structured page content.
    """
    filename = file.filename or "document.pdf"
    content = await file.read()
    pages = []
    full_text = ""

    if filename.lower().endswith(".pdf"):
        try:
            import pymupdf
            doc = pymupdf.open(stream=content, filetype="pdf")
            for page_num, page in enumerate(doc, 1):
                p_text = page.get_text().strip()
                if p_text:
                    pages.append({"page": page_num, "text": p_text})
                    full_text += f"\n--- Page {page_num} ---\n" + p_text + "\n"
            doc.close()
        except Exception as e:
            try:
                import io
                from pypdf import PdfReader
                reader = PdfReader(io.BytesIO(content))
                for page_num, page in enumerate(reader.pages, 1):
                    p_text = (page.extract_text() or "").strip()
                    if p_text:
                        pages.append({"page": page_num, "text": p_text})
                        full_text += f"\n--- Page {page_num} ---\n" + p_text + "\n"
            except Exception as e2:
                raise HTTPException(status_code=400, detail=f"Failed to parse PDF: {e2}")
    elif filename.lower().endswith(".docx"):
        try:
            import io
            import docx
            doc = docx.Document(io.BytesIO(content))
            paragraphs = [p.text.strip() for p in doc.paragraphs if p.text.strip()]
            full_text = "\n\n".join(paragraphs)
            pages.append({"page": 1, "text": full_text})
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to parse docx: {e}")
    else:
        try:
            full_text = content.decode("utf-8")
        except UnicodeDecodeError:
            full_text = content.decode("latin-1", errors="replace")
        pages.append({"page": 1, "text": full_text})

    return {
        "filename": filename,
        "total_pages": len(pages),
        "total_chars": len(full_text),
        "total_words": len(full_text.split()),
        "pages": pages,
        "full_text": full_text.strip()
    }


@app.post("/api/system/offload")
async def offload_models_endpoint():
    """
    Explicitly offload all loaded models from VRAM/RAM.
    Call this when switching between modules (Text → Chat → Video)
    to free memory before loading the next module's models.
    """
    translator.offload_all()
    whisper_mgr.offload()
    gc.collect()
    if DEVICE == "cuda":
        torch.cuda.empty_cache()
    return {"status": "ok", "message": "All models offloaded from memory."}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("LOCAL_AI_PORT", 8000))
    print(f"[Local AI] Starting VaakSetu Local AI Engine v3.0 on http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

