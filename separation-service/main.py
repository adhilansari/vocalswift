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

def process_audio(file_path: str, output_id: str, format: str = "mp3", trim_silence: bool = False):
    """
    Runs demucs on the input file and post-processes the result.
    This runs synchronously and should be called in a background task.
    """
    output_folder = os.path.join(OUTPUT_DIR, output_id)
    os.makedirs(output_folder, exist_ok=True)
    
    try:
        print(f"Starting Demucs processing for {file_path}")
        cmd = [
            "demucs",
            "-n", "htdemucs_ft",
            "--two-stems", "vocals",
            "--mp3",
            "--mp3-bitrate", "320",
            "-o", output_folder,
            file_path
        ]
        subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        basename = os.path.splitext(os.path.basename(file_path))[0]
        vocals_mp3_path = os.path.join(output_folder, "htdemucs_ft", basename, "vocals.mp3")
        
        if not os.path.exists(vocals_mp3_path):
             raise Exception(f"Expected output file not found at {vocals_mp3_path}")
             
        final_output_path = os.path.join(output_folder, "final_vocals.mp3")
        shutil.move(vocals_mp3_path, final_output_path)
        
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
async def upload_file(background_tasks: BackgroundTasks, file: UploadFile = File(...), trim_silence: bool = Form(False)):
    job_id = str(uuid.uuid4())
    file_ext = os.path.splitext(file.filename)[1]
    save_path = os.path.join(UPLOAD_DIR, f"{job_id}{file_ext}")
    
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    background_tasks.add_task(process_audio, save_path, job_id, "mp3", trim_silence)
    
    return {"job_id": job_id, "status": "processing"}

class YoutubeRequest(BaseModel):
    url: str
    trim_silence: bool = False

@app.post("/upload-youtube")
async def upload_youtube(req: YoutubeRequest, background_tasks: BackgroundTasks):
    job_id = str(uuid.uuid4())
    
    # We will use yt-dlp to download the audio to the uploads directory
    save_path = os.path.join(UPLOAD_DIR, f"{job_id}.mp3")
    
    try:
        import yt_dlp
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
            
    except Exception as e:
        print(f"Error downloading youtube: {e}")
        raise HTTPException(status_code=400, detail=str(e))
        
    background_tasks.add_task(process_audio, save_path, job_id, "mp3", req.trim_silence)
    
    return {"job_id": job_id, "status": "processing"}

@app.get("/status/{job_id}")
async def get_status(job_id: str):
    output_folder = os.path.join(OUTPUT_DIR, job_id)
    final_output_path = os.path.join(output_folder, "final_vocals.mp3")
    
    if os.path.exists(final_output_path):
        return {"job_id": job_id, "status": "completed"}
    
    if os.path.exists(os.path.join(output_folder, "error.txt")):
        return {"job_id": job_id, "status": "failed"}

    if os.path.exists(output_folder):
         return {"job_id": job_id, "status": "processing"}
         
    return {"job_id": job_id, "status": "not_found"}

@app.get("/download/{job_id}")
async def download_file(job_id: str):
    output_folder = os.path.join(OUTPUT_DIR, job_id)
    final_output_path = os.path.join(output_folder, "final_vocals.mp3")
    
    if os.path.exists(final_output_path):
        return FileResponse(
            path=final_output_path, 
            filename="vocals.mp3",
            media_type="audio/mpeg"
        )
    
    raise HTTPException(status_code=404, detail="File not ready or not found")

@app.get("/")
def read_root():
    return {"message": "Vocal Separation Service API"}
