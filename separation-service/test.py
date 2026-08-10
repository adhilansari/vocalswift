import yt_dlp
import sys

ydl_opts = {
    "format": "bestaudio/best",
    "noplaylist": True,
    "quiet": False,
    "no_warnings": False,
    "extractor_args": {"youtube": ["player_client=android", "player_client=default"]},
}

try:
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info("https://www.youtube.com/watch?v=jNQXAC9IVRw", download=False)
        print("SUCCESS:", info.get("title"))
except Exception as e:
    print("ERROR:", e)
