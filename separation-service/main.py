"""
Vocal Separation Service
-------------------------
FastAPI backend that runs Demucs to isolate vocals from uploaded audio
or a YouTube link, with optional silence trimming and loudness
normalization.

Key improvements over the original version:
  - Config pulled from environment variables instead of hardcoded paths
  - Proper logging instead of print()
  - CORS no longer combines wildcard origins with credentials (invalid/insecure)
  - Upload validation: extension whitelist + max file size
  - Concurrency limit on Demucs jobs (they're CPU/GPU + RAM heavy)
  - Atomic progress-file writes (no half-written JSON reads)
  - Background cleanup of old job folders (disk doesn't grow forever)
  - Removed duplicate/unused YouTubeRequest model
  - Cross-platform demucs/ffmpeg resolution (falls back to PATH lookup)
  - Consistent, typed error responses
"""

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from pydub import AudioSegment
from pydub.silence import detect_nonsilent

# --------------------------------------------------------------------------
# Config (env-overridable, sensible defaults, no hardcoded Windows paths)
# --------------------------------------------------------------------------

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("vocal-separation")

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", BASE_DIR / "uploads"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", BASE_DIR / "outputs"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Optional explicit paths (only needed if the binaries aren't already on PATH).
FFMPEG_DIR = os.environ.get("FFMPEG_DIR")  # e.g. C:\...\ffmpeg\bin
if FFMPEG_DIR and FFMPEG_DIR not in os.environ.get("PATH", ""):
    os.environ["PATH"] = os.environ.get("PATH", "") + os.pathsep + FFMPEG_DIR

# Force use of local venv demucs for Windows CUDA support
DEMUCS_BIN = os.environ.get("DEMUCS_BIN", os.path.abspath(os.path.join(os.path.dirname(__file__), "venv", "Scripts", "demucs.exe")))
DEMUCS_DEVICE = os.environ.get("DEMUCS_DEVICE", "cuda")  # "cuda" or "cpu"

CORS_ORIGINS = [
    o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000").split(",") if o.strip()
]

MAX_UPLOAD_BYTES = int(os.environ.get("MAX_UPLOAD_MB", "100")) * 1024 * 1024
ALLOWED_UPLOAD_EXTS = {".mp3", ".wav", ".m4a", ".flac", ".ogg", ".aac", ".mp4", ".mov"}

MAX_CONCURRENT_JOBS = int(os.environ.get("MAX_CONCURRENT_JOBS", "1"))
JOB_TTL_HOURS = float(os.environ.get("JOB_TTL_HOURS", "6"))
YOUTUBE_MAX_DURATION_SEC = int(os.environ.get("YOUTUBE_MAX_DURATION_SEC", str(15 * 60)))

# Limits how many Demucs jobs run at once so the box doesn't fall over
# under concurrent requests.
job_semaphore = asyncio.Semaphore(MAX_CONCURRENT_JOBS)


# --------------------------------------------------------------------------
# App setup
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    yield
    cleanup_task.cancel()


app = FastAPI(title="Vocal Separation Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --------------------------------------------------------------------------
# Utilities
# --------------------------------------------------------------------------

def write_progress(output_folder: Path, message: str, progress: int, status: str = "processing") -> None:
    """Atomically write progress.json so readers never see a half-written file."""
    payload = {"status": status, "message": message, "progress": progress}
    fd, tmp_path = tempfile.mkstemp(dir=output_folder, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(payload, f)
        os.replace(tmp_path, output_folder / "progress.json")
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def remove_no_vocal_gaps(
    audio: AudioSegment,
    min_gap_ms: int = 3000,
    silence_thresh_offset_db: int = 16,
    crossfade_ms: int = 80,
    padding_ms: int = 300,
) -> AudioSegment:
    """
    Cuts out long instrumental-only stretches from an isolated vocal track,
    while keeping short natural pauses between vocal lines intact.
    """
    if len(audio) == 0:
        return audio

    silence_thresh = audio.dBFS - silence_thresh_offset_db
    nonsilent_ranges = detect_nonsilent(audio, min_silence_len=min_gap_ms, silence_thresh=silence_thresh)
    if not nonsilent_ranges:
        return audio

    padded = [(max(0, s - padding_ms), min(len(audio), e + padding_ms)) for s, e in nonsilent_ranges]
    merged = [padded[0]]
    for s, e in padded[1:]:
        last_s, last_e = merged[-1]
        if s <= last_e:
            merged[-1] = (last_s, max(last_e, e))
        else:
            merged.append((s, e))

    result = AudioSegment.empty()
    for i, (s, e) in enumerate(merged):
        chunk = audio[s:e]
        if i == 0:
            result = chunk
        else:
            can_crossfade = len(result) > crossfade_ms and len(chunk) > crossfade_ms
            result = result.append(chunk, crossfade=crossfade_ms if can_crossfade else 0)
    return result


def loudness_normalize(input_path: Path, output_path: Path) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(input_path), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", str(output_path)],
        check=True,
        capture_output=True,
    )


def _validate_upload(file: UploadFile) -> None:
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext or 'unknown'}")


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9 ._-]+")


def _safe_stem(name: str, fallback: str) -> str:
    """Sanitizes a user-supplied or video-title filename for use in a
    Content-Disposition download name."""
    stem = Path(name or "").stem.strip()
    stem = _SAFE_NAME_RE.sub("_", stem)[:80].strip("._ ")
    return stem or fallback


def _write_meta(output_folder: Path, original_name: str) -> None:
    (output_folder / "meta.json").write_text(json.dumps({"original_name": original_name}))


def _read_original_name(output_folder: Path, fallback: str) -> str:
    meta_path = output_folder / "meta.json"
    if meta_path.exists():
        try:
            return json.loads(meta_path.read_text()).get("original_name") or fallback
        except (json.JSONDecodeError, OSError):
            pass
    return fallback


async def _periodic_cleanup(interval_sec: int = 3600) -> None:
    """Background loop that deletes job folders older than JOB_TTL_HOURS."""
    while True:
        try:
            cutoff = time.time() - JOB_TTL_HOURS * 3600
            for base in (UPLOAD_DIR, OUTPUT_DIR):
                for entry in base.iterdir():
                    try:
                        if entry.stat().st_mtime < cutoff:
                            if entry.is_dir():
                                shutil.rmtree(entry, ignore_errors=True)
                            else:
                                entry.unlink(missing_ok=True)
                    except FileNotFoundError:
                        pass
        except Exception:
            logger.exception("Cleanup pass failed")
        await asyncio.sleep(interval_sec)


# --------------------------------------------------------------------------
# Core processing
# --------------------------------------------------------------------------

def _run_demucs(file_path: Path, output_folder: Path, model_name: str) -> Path:
    cmd = [
        DEMUCS_BIN,
        "--two-stems", "vocals",
        "-n", model_name,
        "-o", str(output_folder),
        str(file_path),
        "--mp3",
        "--mp3-bitrate", "320",
        "-d", DEMUCS_DEVICE,
    ]
    write_progress(output_folder, "Starting separation engine...", 0)

    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        universal_newlines=True,
    )

    num_models = 4
    current_model_idx = 0
    last_progress_val = 0
    current_line = ""

    # Read char-by-char: demucs/tqdm write \r progress updates, and reading
    # line-by-line via readline() would block until a \n that never comes.
    assert process.stdout is not None
    while True:
        char = process.stdout.read(1)
        if not char:
            break
        if char in ("\r", "\n"):
            match = re.search(r"(\d+)%", current_line)
            if match:
                progress_val = int(match.group(1))
                if progress_val < last_progress_val - 50:
                    current_model_idx += 1
                last_progress_val = progress_val
                safe_idx = min(current_model_idx, num_models - 1)
                model_budget = 70.0 / num_models
                total_progress = int(safe_idx * model_budget + (progress_val / 100.0) * model_budget)
                write_progress(
                    output_folder,
                    f"Separating vocals... {progress_val}% (Pass {safe_idx + 1}/{num_models})",
                    total_progress,
                )
            current_line = ""
        else:
            current_line += char

    process.wait()
    if process.returncode != 0:
        raise subprocess.CalledProcessError(process.returncode, cmd, output="Separation failed")

    basename = file_path.stem
    vocals_mp3_path = output_folder / model_name / basename / "vocals.mp3"
    if not vocals_mp3_path.exists():
        raise FileNotFoundError(f"Expected Demucs output not found at {vocals_mp3_path}")
    return vocals_mp3_path


def process_audio(
    file_path_str: str,
    output_id: str,
    output_format: str = "mp3",
    trim_silence: bool = False,
    min_gap_seconds: float = 3.0,
    normalize: bool = True,
    fast_mode: bool = False,
) -> str:
    """Runs demucs on the input file and post-processes the result. Synchronous;
    intended to be called from a background task under job_semaphore."""
    file_path = Path(file_path_str)
    output_folder = OUTPUT_DIR / output_id
    output_folder.mkdir(parents=True, exist_ok=True)
    model_dir_to_clean: Optional[Path] = None

    try:
        logger.info("Starting Demucs processing for %s", file_path)
        model_name = "mdx_extra_q" if fast_mode else "htdemucs_ft"

        vocals_mp3_path = _run_demucs(file_path, output_folder, model_name)
        model_dir_to_clean = output_folder / model_name
        working_path = vocals_mp3_path

        if trim_silence:
            write_progress(output_folder, "Trimming instrumental-only sections...", 75)
            audio = AudioSegment.from_file(working_path)
            trimmed = remove_no_vocal_gaps(audio, min_gap_ms=int(min_gap_seconds * 1000))
            trimmed_path = output_folder / "vocals_trimmed.wav"
            trimmed.export(trimmed_path, format="wav")
            working_path = trimmed_path

        if normalize:
            write_progress(output_folder, "Normalizing loudness...", 90)
            normalized_path = output_folder / "vocals_normalized.wav"
            loudness_normalize(working_path, normalized_path)
            working_path = normalized_path

        write_progress(output_folder, "Finalizing...", 95)
        ext = "mp3" if output_format == "mp3" else "wav"
        final_output_path = output_folder / f"final_vocals.{ext}"

        if working_path == vocals_mp3_path and not trim_silence and not normalize and working_path.suffix == f".{ext}":
            shutil.move(str(working_path), str(final_output_path))
        elif ext == "mp3":
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(working_path), "-codec:a", "libmp3lame", "-b:a", "320k", str(final_output_path)],
                check=True,
                capture_output=True,
            )
        else:
            subprocess.run(["ffmpeg", "-y", "-i", str(working_path), str(final_output_path)], check=True, capture_output=True)

        # Clean up intermediates: full demucs model dir (drums/bass/other stems)
        # and any temp trim/normalize files.
        if model_dir_to_clean and model_dir_to_clean.exists():
            shutil.rmtree(model_dir_to_clean, ignore_errors=True)
        for intermediate in ("vocals_trimmed.wav", "vocals_normalized.wav"):
            p = output_folder / intermediate
            if p.exists() and p != final_output_path:
                p.unlink()

        write_progress(output_folder, "Done", 100, status="completed")
        logger.info("Processing complete: %s", final_output_path)
        return str(final_output_path)

    except subprocess.CalledProcessError as e:
        logger.error("ffmpeg/demucs failed: %s", e.stderr)
        (output_folder / "error.txt").write_text(str(e.stderr or e))
        write_progress(output_folder, "Processing failed", 0, status="failed")
        raise
    except Exception as e:
        logger.exception("Processing error")
        (output_folder / "error.txt").write_text(str(e))
        write_progress(output_folder, "Processing failed", 0, status="failed")
        raise
    finally:
        # Always drop the raw upload once we're done with it, win or lose.
        try:
            if file_path.exists():
                file_path.unlink()
        except OSError:
            logger.warning("Could not remove upload %s", file_path)


async def _process_audio_job(*args, **kwargs) -> None:
    """Wraps process_audio with the concurrency limiter, for use in BackgroundTasks."""
    async with job_semaphore:
        await asyncio.to_thread(process_audio, *args, **kwargs)


# --------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------

@app.get("/system-stats")
async def get_system_stats():
    import psutil

    return {
        "cpu": psutil.cpu_percent(interval=None),
        "ram": psutil.virtual_memory().percent,
    }


@app.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    trim_silence: bool = Form(False),
    min_gap_seconds: float = Form(3.0),
    normalize: bool = Form(True),
    output_format: str = Form("mp3"),
    fast_mode: bool = Form(False),
):
    if output_format not in ("mp3", "wav"):
        raise HTTPException(status_code=400, detail="output_format must be 'mp3' or 'wav'")
    _validate_upload(file)

    job_id = str(uuid.uuid4())
    file_ext = Path(file.filename or "").suffix
    save_path = UPLOAD_DIR / f"{job_id}{file_ext}"

    size = 0
    with open(save_path, "wb") as buffer:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                buffer.close()
                save_path.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_BYTES // (1024*1024)}MB limit")
            buffer.write(chunk)

    output_folder = OUTPUT_DIR / job_id
    output_folder.mkdir(parents=True, exist_ok=True)
    write_progress(output_folder, "Starting separation engine...", 0)
    _write_meta(output_folder, file.filename or job_id)

    background_tasks.add_task(
        _process_audio_job, str(save_path), job_id, output_format, trim_silence, min_gap_seconds, normalize, fast_mode
    )
    return {"job_id": job_id, "status": "processing"}


class YoutubeRequest(BaseModel):
    url: str
    trim_silence: bool = False
    min_gap_seconds: float = Field(3.0, ge=0)
    normalize: bool = True
    output_format: str = "mp3"
    fast_mode: bool = False


@app.post("/upload-youtube")
async def upload_youtube(req: YoutubeRequest, background_tasks: BackgroundTasks):
    if req.output_format not in ("mp3", "wav"):
        raise HTTPException(status_code=400, detail="output_format must be 'mp3' or 'wav'")

    job_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{job_id}.mp3"
    output_folder = OUTPUT_DIR / job_id
    output_folder.mkdir(parents=True, exist_ok=True)
    write_progress(output_folder, "Downloading YouTube audio...", 0)

    def run_yt_dlp() -> str:
        import yt_dlp

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": str(UPLOAD_DIR / f"{job_id}.%(ext)s"),
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": ["android"]}},  # Bypass YouTube bot detection
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            duration = info.get("duration") or 0
            if duration > YOUTUBE_MAX_DURATION_SEC:
                raise HTTPException(status_code=400, detail=f"Video is too long (max {YOUTUBE_MAX_DURATION_SEC // 60} minutes).")
            ydl.download([req.url])
            return info.get("title") or job_id

    try:
        video_title = await asyncio.to_thread(run_yt_dlp)
        _write_meta(output_folder, video_title)
        write_progress(output_folder, "Download complete. Queued for separation...", 10)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("YouTube download failed")
        raise HTTPException(status_code=400, detail=str(e))

    background_tasks.add_task(
        _process_audio_job, str(save_path), job_id, req.output_format, req.trim_silence, req.min_gap_seconds, req.normalize, req.fast_mode
    )
    return {"job_id": job_id, "status": "processing"}


class YoutubePreviewRequest(BaseModel):
    url: str


@app.post("/download-youtube-preview")
async def download_youtube_preview(req: YoutubePreviewRequest):
    job_id = str(uuid.uuid4())

    def run_yt_dlp():
        import yt_dlp

        ydl_opts = {
            "format": "bestaudio/best",
            "outtmpl": str(UPLOAD_DIR / f"{job_id}.%(ext)s"),
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3", "preferredquality": "192"}],
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": ["android"]}},  # Bypass YouTube bot detection
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(req.url, download=False)
            duration = info.get("duration") or 0
            if duration > YOUTUBE_MAX_DURATION_SEC:
                raise HTTPException(status_code=400, detail=f"Video is too long (max {YOUTUBE_MAX_DURATION_SEC // 60} minutes).")
            ydl.download([req.url])

    try:
        await asyncio.to_thread(run_yt_dlp)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("YouTube preview download failed")
        raise HTTPException(status_code=400, detail=str(e))

    return {"job_id": job_id, "status": "completed"}


@app.get("/status/{job_id}")
async def get_status(job_id: str):
    output_folder = OUTPUT_DIR / job_id
    if (output_folder / "final_vocals.mp3").exists() or (output_folder / "final_vocals.wav").exists():
        return {"job_id": job_id, "status": "completed"}

    if (output_folder / "error.txt").exists():
        return {"job_id": job_id, "status": "failed", "message": (output_folder / "error.txt").read_text()}

    progress_file = output_folder / "progress.json"
    if progress_file.exists():
        try:
            data = json.loads(progress_file.read_text())
            data["job_id"] = job_id
            return data
        except (json.JSONDecodeError, OSError):
            pass

    if output_folder.exists():
        return {"job_id": job_id, "status": "processing"}

    return {"job_id": job_id, "status": "not_found"}


@app.get("/download/{job_id}")
async def download_file(job_id: str):
    output_folder = OUTPUT_DIR / job_id
    mp3_path = output_folder / "final_vocals.mp3"
    wav_path = output_folder / "final_vocals.wav"

    original_name = _read_original_name(output_folder, fallback=job_id)
    stem = _safe_stem(original_name, fallback=job_id)

    if mp3_path.exists():
        return FileResponse(path=mp3_path, filename=f"{stem}_vocals.mp3", media_type="audio/mpeg")
    elif wav_path.exists():
        return FileResponse(path=wav_path, filename=f"{stem}_vocals.wav", media_type="audio/wav")

    raise HTTPException(status_code=404, detail="File not ready or not found")


@app.get("/raw-download/{job_id}")
async def download_raw_file(job_id: str):
    output_folder = OUTPUT_DIR / job_id
    mp3_path = output_folder / "final_vocals.mp3"
    wav_path = output_folder / "final_vocals.wav"

    if mp3_path.exists():
        return FileResponse(path=mp3_path, media_type="audio/mpeg")
    elif wav_path.exists():
        return FileResponse(path=wav_path, media_type="audio/wav")

    # If Youtube preview:
    youtube_preview_path = UPLOAD_DIR / f"{job_id}.mp3"
    if youtube_preview_path.exists():
        return FileResponse(path=youtube_preview_path, media_type="audio/mpeg")
        
    raise HTTPException(status_code=404, detail="Raw file not ready or not found")

@app.get("/")
def read_root():
    return {"message": "Vocal Separation Service API"}
