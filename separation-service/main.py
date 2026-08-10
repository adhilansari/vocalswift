import os
ffmpeg_path = r"C:\Users\adhil\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0-full_build\bin"
if ffmpeg_path not in os.environ.get("PATH", ""):
    os.environ["PATH"] += os.pathsep + ffmpeg_path

import shutil
import subprocess
import uuid
from typing import Optional
from fastapi import FastAPI, File, UploadFile, BackgroundTasks, HTTPException, Form
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psutil

app = FastAPI(title="Vocal Separation Service")

@app.get("/system-stats")
async def get_system_stats():
    # Gather CPU and RAM usage
    cpu = psutil.cpu_percent(interval=None)
    ram = psutil.virtual_memory().percent
    return {
        "cpu": cpu,
        "ram": ram
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = "uploads"
OUTPUT_DIR = "outputs"

os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

class YouTubeRequest(BaseModel):
    url: str

# -----------------------------------------------------------------------
# Silence / no-vocal-gap trimming
# -----------------------------------------------------------------------
from pydub import AudioSegment
from pydub.silence import detect_nonsilent

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
    nonsilent_ranges = detect_nonsilent(
        audio, min_silence_len=min_gap_ms, silence_thresh=silence_thresh
    )
    if not nonsilent_ranges:
        return audio

    padded = [
        (max(0, s - padding_ms), min(len(audio), e + padding_ms)) for s, e in nonsilent_ranges
    ]
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

def loudness_normalize(input_path: str, output_path: str) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
            output_path,
        ],
        check=True,
        capture_output=True,
    )

def process_audio(
    file_path: str,
    output_id: str,
    output_format: str = "mp3",
    trim_silence: bool = False,
    min_gap_seconds: float = 3.0,
    normalize: bool = True,
    fast_mode: bool = False,
):
    """
    Runs demucs on the input file and post-processes the result.
    This runs synchronously and should be called in a background task.
    """
    output_folder = os.path.join(OUTPUT_DIR, output_id)
    os.makedirs(output_folder, exist_ok=True)
    
    try:
        print(f"Starting Demucs processing for {file_path}")
        model_name = "mdx_extra_q" if fast_mode else "htdemucs_ft"
        cmd = [
            "demucs",
            "-n", model_name,
            "--two-stems", "vocals",
            "--mp3",
            "--mp3-bitrate", "320",
            "-o", output_folder,
            file_path
        ]
        import json
        import re
        
        def write_progress(message: str, progress: int):
            with open(os.path.join(output_folder, "progress.json"), "w") as f:
                json.dump({"status": "processing", "message": message, "progress": progress}, f)
        
        write_progress("Starting separation engine...", 0)
            
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            universal_newlines=True
        )
        
        num_models = 4
        current_model_idx = 0
        last_progress_val = 0
        
        for line in process.stdout:
            match = re.search(r'(\d+)%', line)
            if match:
                progress_val = int(match.group(1))
                
                if progress_val < last_progress_val - 50:
                    current_model_idx += 1
                
                last_progress_val = progress_val
                safe_idx = min(current_model_idx, num_models - 1)
                
                model_budget = 70.0 / num_models
                base_progress = safe_idx * model_budget
                current_model_progress = (progress_val / 100.0) * model_budget
                
                total_progress = int(base_progress + current_model_progress)
                write_progress(f"Separating vocals... {progress_val}% (Pass {safe_idx + 1}/{num_models})", total_progress)
        
        process.wait()
        if process.returncode != 0:
            raise subprocess.CalledProcessError(process.returncode, cmd, output="Separation failed")
        
        basename = os.path.splitext(os.path.basename(file_path))[0]
        htdemucs_dir = os.path.join(output_folder, model_name)
        vocals_mp3_path = os.path.join(htdemucs_dir, basename, "vocals.mp3")
        
        if not os.path.exists(vocals_mp3_path):
             raise Exception(f"Expected output file not found at {vocals_mp3_path}")
             
        working_path = vocals_mp3_path

        # --- Trim no-vocal gaps ---
        if trim_silence:
            write_progress("Trimming instrumental-only sections...", 75)
            audio = AudioSegment.from_file(working_path)
            trimmed = remove_no_vocal_gaps(audio, min_gap_ms=int(min_gap_seconds * 1000))
            trimmed_path = os.path.join(output_folder, "vocals_trimmed.wav")
            trimmed.export(trimmed_path, format="wav")
            working_path = trimmed_path

        # --- Normalize loudness ---
        if normalize:
            write_progress("Normalizing loudness...", 90)
            normalized_path = os.path.join(output_folder, "vocals_normalized.wav")
            loudness_normalize(working_path, normalized_path)
            working_path = normalized_path

        # --- Final export ---
        write_progress("Finalizing...", 95)
        ext = "mp3" if output_format == "mp3" else "wav"
        final_output_path = os.path.join(output_folder, f"final_vocals.{ext}")

        if working_path.endswith(f".{ext}") and working_path == vocals_mp3_path and not trim_silence and not normalize:
            shutil.move(working_path, final_output_path)
        elif ext == "mp3":
            subprocess.run(
                ["ffmpeg", "-y", "-i", working_path, "-codec:a", "libmp3lame", "-b:a", "320k", final_output_path],
                check=True, capture_output=True,
            )
        else:
            subprocess.run(["ffmpeg", "-y", "-i", working_path, final_output_path], check=True, capture_output=True)
        
        # Clean up unwanted stems (drums, bass, other)
        if os.path.exists(htdemucs_dir):
            shutil.rmtree(htdemucs_dir)
        for intermediate in ("vocals_trimmed.wav", "vocals_normalized.wav"):
            p = os.path.join(output_folder, intermediate)
            if os.path.exists(p) and p != final_output_path:
                os.remove(p)
                
        write_progress("Done", 100)
        print(f"Processing complete: {final_output_path}")
        return final_output_path
        
    except subprocess.CalledProcessError as e:
        print(f"Error during processing: {e.stderr}")
        with open(os.path.join(output_folder, "error.txt"), "w") as f:
            f.write(str(e.stderr))
        raise
    except Exception as e:
        print(f"Error: {e}")
        with open(os.path.join(output_folder, "error.txt"), "w") as f:
            f.write(str(e))
        raise

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
    job_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1]
    save_path = os.path.join(UPLOAD_DIR, f"{job_id}{file_ext}")
    
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    background_tasks.add_task(
        process_audio, 
        save_path, 
        job_id, 
        output_format,
        trim_silence,
        min_gap_seconds,
        normalize,
        fast_mode
    )
    return {"job_id": job_id, "status": "processing"}

class YoutubeRequest(BaseModel):
    url: str
    trim_silence: bool = False
    min_gap_seconds: float = 3.0
    normalize: bool = True
    output_format: str = "mp3"
    fast_mode: bool = False

@app.post("/upload-youtube")
async def upload_youtube(req: YoutubeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    
    # We will use yt-dlp to download the audio to the uploads directory
    save_path = os.path.join(UPLOAD_DIR, f"{job_id}.mp3")
    
    try:
        import yt_dlp
        import json
        import asyncio
        
        output_folder = os.path.join(OUTPUT_DIR, job_id)
        os.makedirs(output_folder, exist_ok=True)
        with open(os.path.join(output_folder, "progress.json"), "w") as f:
            json.dump({"status": "processing", "message": "Downloading YouTube audio... 0%", "progress": 0}, f)
            
        def run_yt_dlp():
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": os.path.join(UPLOAD_DIR, f"{job_id}.%(ext)s"),
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(req.url, download=False)
                duration = info.get("duration") or 0
                if duration > 15 * 60:
                    raise HTTPException(status_code=400, detail="Video is too long (Max 15 minutes).")
                ydl.download([req.url])

        await asyncio.to_thread(run_yt_dlp)
            
        with open(os.path.join(output_folder, "progress.json"), "w") as f:
            json.dump({"status": "processing", "message": "Download complete. Queued for separation...", "progress": 10}, f)
            
    except Exception as e:
        print(f"Error downloading youtube: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail=str(e))
        
    background_tasks.add_task(process_audio, save_path, job_id, req.output_format, req.trim_silence, req.min_gap_seconds, req.normalize, req.fast_mode)
    
    return {"job_id": job_id, "status": "processing"}

class YoutubePreviewRequest(BaseModel):
    url: str

@app.post("/download-youtube-preview")
async def download_youtube_preview(req: YoutubePreviewRequest):
    job_id = str(uuid.uuid4())
    
    try:
        import yt_dlp
        import asyncio
        
        def run_yt_dlp():
            ydl_opts = {
                "format": "bestaudio/best",
                "outtmpl": os.path.join(UPLOAD_DIR, f"{job_id}.%(ext)s"),
                "postprocessors": [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3",
                        "preferredquality": "192",
                    }
                ],
                "noplaylist": True,
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(req.url, download=False)
                duration = info.get("duration") or 0
                if duration > 15 * 60:
                    raise HTTPException(status_code=400, detail="Video is too long (Max 15 minutes).")
                ydl.download([req.url])
                
        await asyncio.to_thread(run_yt_dlp)
            
    except Exception as e:
        print(f"Error downloading youtube preview: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=400, detail=str(e))
        
    return {"job_id": job_id, "status": "completed"}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    output_folder = os.path.join(OUTPUT_DIR, job_id)
    if os.path.exists(os.path.join(output_folder, "final_vocals.mp3")) or \
       os.path.exists(os.path.join(output_folder, "final_vocals.wav")):
        return {"job_id": job_id, "status": "completed"}
    
    if os.path.exists(os.path.join(output_folder, "error.txt")):
        return {"job_id": job_id, "status": "failed"}

    progress_file = os.path.join(output_folder, "progress.json")
    if os.path.exists(progress_file):
        try:
            import json
            with open(progress_file, "r") as f:
                data = json.load(f)
                data["job_id"] = job_id
                return data
        except Exception:
            pass

    if os.path.exists(output_folder):
         return {"job_id": job_id, "status": "processing"}
         
    return {"job_id": job_id, "status": "not_found"}

@app.get("/download/{job_id}")
async def download_file(job_id: str):
    output_folder = os.path.join(OUTPUT_DIR, job_id)
    mp3_path = os.path.join(output_folder, "final_vocals.mp3")
    wav_path = os.path.join(output_folder, "final_vocals.wav")
    
    if os.path.exists(mp3_path):
        return FileResponse(
            path=mp3_path, 
            filename="vocals.mp3",
            media_type="audio/mpeg"
        )
    elif os.path.exists(wav_path):
        return FileResponse(
            path=wav_path, 
            filename="vocals.wav",
            media_type="audio/wav"
        )
    
    raise HTTPException(status_code=404, detail="File not ready or not found")

@app.get("/raw-download/{job_id}")
async def download_raw_file(job_id: str):
    file_path = os.path.join(UPLOAD_DIR, f"{job_id}.mp3")
    if os.path.exists(file_path):
        return FileResponse(
            path=file_path, 
            filename=f"raw_{job_id}.mp3",
            media_type="audio/mpeg"
        )
    raise HTTPException(status_code=404, detail="File not found")

@app.get("/")
def read_root():
    return {"message": "Vocal Separation Service API"}
