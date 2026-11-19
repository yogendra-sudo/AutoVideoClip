"""
YouTube-related API routes
Handles YouTube video parsing and download features
"""

import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, Form, UploadFile, File
from pydantic import BaseModel
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent.parent))
from ...core.config import get_data_directory
from ...utils.ffmpeg_utils import ytdlp_ffmpeg_options
import uuid
import asyncio
from datetime import datetime
from contextlib import contextmanager
import os
import yt_dlp

logger = logging.getLogger(__name__)
router = APIRouter()

# Store download task states
download_tasks = {}

# Requesting too many subtitle languages at once triggers YouTube HTTP 429 and fails the whole download;
# default to Chinese and English only, overridable via AUTOVIDEOCLIP_YT_SUBTITLE_LANGS (comma-separated).
DEFAULT_SUBTITLE_LANGS = ['zh-Hans', 'zh', 'en']


def get_subtitle_langs() -> list:
    raw = os.getenv('AUTOVIDEOCLIP_YT_SUBTITLE_LANGS', '')
    langs = [lang.strip() for lang in raw.split(',') if lang.strip()]
    return langs or list(DEFAULT_SUBTITLE_LANGS)


@contextmanager
def sanitized_yt_env():
    """Temporarily clear yt-dlp-related environment variables to avoid external config affecting behavior"""
    original_env = os.environ.copy()
    try:
        for key in list(os.environ.keys()):
            upper_key = key.upper()
            if upper_key.startswith("YT_DLP") or upper_key.startswith("YTDL") or upper_key.startswith("YOUTUBE_DL") or upper_key.startswith("YOUTUBEDL"):
                os.environ.pop(key, None)
        yield
    finally:
        os.environ.clear()
        os.environ.update(original_env)

class YouTubeParseRequest(BaseModel):
    url: str
    browser: Optional[str] = None

class YouTubeDownloadRequest(BaseModel):
    url: str
    project_name: str
    video_category: Optional[str] = "default"
    browser: Optional[str] = None

class YouTubeVideoInfo(BaseModel):
    title: str
    description: str
    duration: int
    uploader: str
    upload_date: str
    view_count: int
    like_count: int
    thumbnail: str

class YouTubeDownloadTask(BaseModel):
    id: str
    url: str
    project_name: str
    video_category: str
    status: str  # pending, processing, completed, failed
    progress: float
    error_message: Optional[str] = None
    project_id: Optional[str] = None
    created_at: str
    updated_at: str

@router.post("/parse")
async def parse_youtube_video(
    url: str = Form(...),
    browser: Optional[str] = Form(None),
    client: Optional[str] = Form(None)
):
    """Parse YouTube video info"""
    try:
        logger.info(f"Start parsing YouTube video: {url}")
        
        # Simple URL validation
        if "youtube.com" not in url and "youtu.be" not in url:
            raise HTTPException(status_code=400, detail="Invalid YouTube video link")
        
        # Log version info to aid troubleshooting
        try:
            logger.info(f"yt-dlp={yt_dlp.version.__version__}, py={sys.executable}")
        except Exception:
            pass

        # Use subprocess to call the yt-dlp CLI directly, avoiding Python environment config effects
        import subprocess
        import json
        import asyncio
        
        def extract_info_sync(url, browser):
            # Use the current interpreter's yt_dlp module to match the backend runtime (venv / Docker / desktop portable Python)
            cmd = [
                sys.executable, '-m', 'yt_dlp',
                '--ignore-config',
                '--no-warnings',
                '--no-playlist',
                '--dump-json',
                '--skip-download',  # corrected parameter name
                '--no-cache-dir'
            ]
            
            if browser:
                cmd.extend(['--cookies-from-browser', browser.lower()])

            # Optional fallback client to bypass SABR
            yt_client = (client or os.getenv('AUTOVIDEOCLIP_YT_CLIENT', '')).strip().lower()
            if yt_client in {"android", "ios", "tv"}:
                cmd.extend(['--extractor-args', f"youtube:player_client={yt_client}"])
            
            cmd.append(url)
            
            try:
                # Execute command (clean environment vars to avoid YT_* influence)
                env = os.environ.copy()
                for k in list(env.keys()):
                    uk = k.upper()
                    if uk.startswith('YT_DLP') or uk.startswith('YTDL') or uk.startswith('YOUTUBE_DL') or uk.startswith('YOUTUBEDL'):
                        env.pop(k, None)

                logger.info(f"Executing command: {' '.join(cmd)}")
                result = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                    cwd=str(get_data_directory()),
                    env=env
                )

                logger.info(f"Command return code: {result.returncode}")
                logger.info(f"Command output (first 200 chars): {result.stdout[:200]}...")
                if result.stderr:
                    logger.info(f"Command error: {result.stderr}")

                if result.returncode != 0:
                    raise Exception(f"yt-dlp failed: {result.stderr or result.stdout}")

                # Parse JSON output
                info_dict = json.loads(result.stdout)
                return info_dict
                
            except subprocess.TimeoutExpired:
                raise Exception("yt-dlp timeout")
            except json.JSONDecodeError as e:
                raise Exception(f"Failed to parse yt-dlp output: {e}")
            except Exception as e:
                raise Exception(f"yt-dlp execution failed: {e}")
        
        loop = asyncio.get_event_loop()
        info_dict = await loop.run_in_executor(None, extract_info_sync, url, browser)
        
        logger.info(f"YouTube video info parsed successfully: {info_dict.get('title', 'Unknown')}")
        
        return {
            "success": True,
            "video_info": {
                "title": info_dict.get('title', 'Unknown'),
                "description": info_dict.get('description', ''),
                "duration": info_dict.get('duration', 0) or 0,
                "uploader": info_dict.get('uploader', 'Unknown'),
                "upload_date": info_dict.get('upload_date', ''),
                "view_count": info_dict.get('view_count', 0),
                "like_count": info_dict.get('like_count', 0),
                "thumbnail": info_dict.get('thumbnail', '')
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to parse YouTube video: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Parse failed: {str(e)}")

@router.post("/download")
async def create_youtube_download_task(request: YouTubeDownloadRequest):
    """Create YouTube video download task - creates project immediately"""
    try:
        logger.info(f"Creating YouTube download task: {request.url}")
        
        # First fetch video info to obtain a thumbnail
        import yt_dlp
        import asyncio
        
        ydl_opts = {
            'quiet': True,
            'socket_timeout': 30,
            'retries': 2,
            'extractor_retries': 2,
            'no_warnings': True,
            'ignoreconfig': True,
            'noplaylist': True,
            'config_locations': [],
            'cachedir': False,
        }
        
        if request.browser:
            ydl_opts['cookiesfrombrowser'] = (request.browser.lower(),)

        # Optional fallback client
        yt_client_env = os.getenv('AUTOVIDEOCLIP_YT_CLIENT', '').strip().lower()
        if yt_client_env in {"android", "ios", "tv"}:
            ydl_opts.setdefault('extractor_args', {}).setdefault('youtube', {}).setdefault('player_client', []).append(yt_client_env)
        
        def extract_info_sync(url, ydl_opts):
            with sanitized_yt_env():
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    return ydl.extract_info(url, download=False)
        
        loop = asyncio.get_event_loop()
        video_info = await loop.run_in_executor(None, extract_info_sync, request.url, ydl_opts)
        
        # Create project record immediately
        from ...core.database import SessionLocal
        from ...services.project_service import ProjectService
        from ...schemas.project import ProjectCreate, ProjectType, ProjectStatus
        
        db = SessionLocal()
        try:
            project_service = ProjectService(db)
            
            # Handle thumbnail - use the parsed cover image directly
            thumbnail_data = None
            thumbnail_url = video_info.get('thumbnail', '')
            if thumbnail_url:
                try:
                    import requests
                    import base64
                    
                    # Download thumbnail
                    response = requests.get(thumbnail_url, timeout=10)
                    if response.status_code == 200:
                        # Convert to base64
                        thumbnail_base64 = base64.b64encode(response.content).decode('utf-8')
                        thumbnail_data = f"data:image/jpeg;base64,{thumbnail_base64}"
                        logger.info(f"YouTube thumbnail fetched successfully: {video_info.get('title', 'Unknown')}")
                    else:
                        logger.warning(f"Failed to download YouTube thumbnail: {response.status_code}")
                except Exception as e:
                    logger.error(f"Failed to process YouTube thumbnail: {e}")
                    # Thumbnail failure does not affect the main flow
            
            # Create project data
            project_data = ProjectCreate(
                name=request.project_name,
                description=f"Downloaded from YouTube: {video_info.get('title', 'Unknown')}",
                project_type=ProjectType(request.video_category),
                status=ProjectStatus.PENDING,  # initial status is pending
                source_url=request.url,
                source_file=None,  # temporarily empty, updated after download completes
                settings={
                    "download_status": "downloading",
                    "download_progress": 0.0,
                    "youtube_info": {
                        "url": request.url,
                        "browser": request.browser,
                        "title": video_info.get('title', 'Unknown'),
                        "uploader": video_info.get('uploader', 'Unknown'),
                        "duration": video_info.get('duration', 0),
                        "view_count": video_info.get('view_count', 0),
                        "thumbnail_url": thumbnail_url
                    }
                }
            )
            
            project = project_service.create_project(project_data)
            project_id = str(project.id)
            
            # Set thumbnail
            if thumbnail_data:
                project.thumbnail = thumbnail_data
                db.commit()
                logger.info(f"Project {project_id} thumbnail set")
            
            # Create project directory
            from ...core.path_utils import get_project_directory
            project_dir = get_project_directory(project_id)
            raw_dir = project_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"Project created: {project_id}")
            
            # Generate download task ID
            task_id = str(uuid.uuid4())
            
            # Create task record
            task = YouTubeDownloadTask(
                id=task_id,
                url=request.url,
                project_name=request.project_name,
                video_category=request.video_category,
                status="pending",
                progress=0.0,
                project_id=project_id,  # linked project ID
                created_at=str(uuid.uuid1().time),
                updated_at=str(uuid.uuid1().time)
            )
            
            # Store task
            download_tasks[task_id] = task
            
            # Start download task asynchronously - using the safe task manager
            from .async_task_manager import task_manager
            await task_manager.create_safe_task(
                f"youtube_download_{task_id}", 
                process_youtube_download_task, 
                task_id, 
                request, 
                project_id
            )
            
            # Return project info rather than task info
            return {
                "project_id": project_id,
                "task_id": task_id,
                "status": "created",
                "message": "Project created, downloading..."
            }
            
        finally:
            db.close()
        
    except Exception as e:
        logger.error(f"Failed to create YouTube download task: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to create task: {str(e)}")

@router.get("/tasks/{task_id}")
async def get_youtube_task_status(task_id: str):
    """Get YouTube download task status"""
    if task_id not in download_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    return download_tasks[task_id]

@router.get("/tasks")
async def get_all_youtube_tasks():
    """Get all YouTube download tasks"""
    return list(download_tasks.values())

async def update_project_download_progress(project_id: str, progress: float, message: str):
    """Update project download progress"""
    save_project_download_progress(project_id, progress, message)


def save_project_download_progress(project_id: str, progress: float, message: str):
    """Synchronously write progress; can be called from the yt-dlp download thread."""
    try:
        from ...core.database import SessionLocal
        from ...services.project_service import ProjectService
        
        db = SessionLocal()
        try:
            project_service = ProjectService(db)
            project = project_service.get(project_id)
            
            if project:
                # Must assign a new dict. Mutating the JSON column in place does not persist; progress would stay at the creation-time 0%.
                from ...services.download_progress import save_processing_config
                save_processing_config(project, {
                    "download_progress": progress,
                    "download_message": message
                })
                
                # If progress reaches 100%, update status to pending processing
                if progress >= 100.0:
                    from ...schemas.project import ProjectStatus
                    project.status = ProjectStatus.PENDING
                
                db.commit()
                logger.info(f"Project {project_id} download progress updated: {progress}% - {message}")
                
        finally:
            db.close()
            
    except Exception as e:
        logger.error(f"Failed to update project download progress: {e}")


# Download stage occupies 30%→60% of total progress
DOWNLOAD_PROGRESS_START = 30.0
DOWNLOAD_PROGRESS_END = 60.0


def make_download_progress_hook(project_id: str, task_id: str, min_interval: float = 1.0):
    """yt-dlp progress_hooks: map the real download percentage to 30%→60%.

    Previously progress jumped from 30 to 60 during download, leaving large videos stuck for minutes; users thought it hung.
    When audio/video are downloaded as two files the percentage drops; only take monotonically increasing values; write to DB at most once per second.
    """
    import time
    state = {"last_write": 0.0, "last_value": DOWNLOAD_PROGRESS_START}

    def hook(d):
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        downloaded = d.get("downloaded_bytes") or 0
        if not total:
            return
        fraction = max(0.0, min(1.0, downloaded / total))
        value = round(DOWNLOAD_PROGRESS_START + fraction * (DOWNLOAD_PROGRESS_END - DOWNLOAD_PROGRESS_START - 1), 1)
        now = time.monotonic()
        if value <= state["last_value"] or now - state["last_write"] < min_interval:
            return
        state["last_value"], state["last_write"] = value, now
        task = download_tasks.get(task_id)
        if task is not None:
            task.progress = value
        save_project_download_progress(project_id, value, f"Downloading video... {int(fraction * 100)}%")

    return hook

async def process_youtube_download_task(task_id: str, request: YouTubeDownloadRequest, project_id: str):
    """Handle YouTube download task"""
    try:
        # Update task status to processing
        download_tasks[task_id].status = "processing"
        download_tasks[task_id].progress = 10.0
        
        # Update project status and progress
        await update_project_download_progress(project_id, 10.0, "Fetching video info...")
        
        # Download video using yt-dlp
        import yt_dlp
        import asyncio
        from ...core.config import get_data_directory
        
        data_dir = get_data_directory()
        # Each attempt owns its files, including retries of the same task.
        # Never discover media in a directory shared with another download.
        import tempfile
        temp_root = data_dir / "temp"
        temp_root.mkdir(parents=True, exist_ok=True)
        download_dir = Path(tempfile.mkdtemp(prefix="youtube-", dir=temp_root))
        
        # Update project progress
        await update_project_download_progress(project_id, 30.0, "Downloading video...")
        
        # Set download options
        ydl_opts = {
            'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
            # unify to mp4 after merging; files are located below via *.mp4
            'merge_output_format': 'mp4',
            'writesubtitles': True,
            'writeautomaticsub': True,  # download auto-generated subtitles
            'subtitleslangs': get_subtitle_langs(),
            'subtitlesformat': 'srt',
            'outtmpl': str(download_dir / '%(title)s.%(ext)s'),
            'noplaylist': True,
            'quiet': True,
            'no_warnings': False,  # show warnings for debugging
            'ignoreconfig': True,
            'config_locations': [],
            'cachedir': False,
            'progress_hooks': [make_download_progress_hook(project_id, task_id)],
            **ytdlp_ffmpeg_options(),
        }
        
        if request.browser:
            ydl_opts['cookiesfrombrowser'] = (request.browser.lower(),)

        # Optional fallback client
        yt_client_env = os.getenv('AUTOVIDEOCLIP_YT_CLIENT', '').strip().lower()
        if yt_client_env in {"android", "ios", "tv"}:
            ydl_opts.setdefault('extractor_args', {}).setdefault('youtube', {}).setdefault('player_client', []).append(yt_client_env)
        
        def download_sync(url, ydl_opts):
            from backend.utils.download_recovery import download_with_recovery
            return download_with_recovery(url, ydl_opts)
        
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, download_sync, request.url, ydl_opts)
        
        # Locate downloaded files
        video_files = list(download_dir.glob("*.mp4"))
        subtitle_files = list(download_dir.glob("*.srt"))
        
        if not video_files:
            raise Exception("No downloaded video file found")
        
        video_path = str(video_files[0])
        subtitle_path = str(subtitle_files[0]) if subtitle_files else ""
        subtitle_error = None
        
        download_tasks[task_id].progress = 80.0
        
        # Update project progress
        await update_project_download_progress(project_id, 60.0, "Video downloaded, processing subtitles...")
        
        # If no subtitle file, prefer generating subtitles with Whisper
        if not subtitle_path:
            logger.info("Preferring Whisper to generate high-quality subtitles")
            # Update project progress
            await update_project_download_progress(project_id, 70.0, "Generating subtitles with Whisper...")
            
            try:
                from ...utils.speech_recognizer import generate_subtitle_for_video, SpeechRecognitionError
                video_file_path = Path(video_path)
                
                # Choose model based on video info
                model = None  # Use the configured local transcription model
                language = "auto"  # auto-detect language by default
                
                # Content type could be inferred from the video title here
                # More intelligent content-type detection could be added here
                
                logger.info(f"Generating subtitles with Whisper - language: {language}, model: {model}")
                
                generated_subtitle = generate_subtitle_for_video(
                    video_file_path,
                    language=language,
                    model=model
                )
                subtitle_path = str(generated_subtitle)
                logger.info(f"Whisper subtitles generated: {subtitle_path}")
                
                # Update project progress
                await update_project_download_progress(project_id, 90.0, "Subtitles generated, preparing for processing...")
                
            except SpeechRecognitionError as e:
                logger.warning("Whisper subtitle generation failed: %s", e)
                whisper_error = str(e)
                # When Whisper fails, try multiple strategies to fetch platform subtitles as a fallback
                logger.info("Attempting to download platform subtitles as a fallback")
                try:
                    subtitle_path = await _try_youtube_subtitle_strategies(request.url, download_dir, request.browser)
                    if subtitle_path:
                        logger.info(f"Fallback subtitles fetched: {subtitle_path}")
                    else:
                        logger.warning("All subtitle strategies failed")
                        subtitle_path = None
                        subtitle_error = whisper_error
                except Exception as backup_error:
                    logger.warning("Fallback subtitle fetch also failed: %s", type(backup_error).__name__)
                    subtitle_path = None
                    subtitle_error = whisper_error
            except Exception as e:
                logger.warning("Unknown error while generating subtitles: %s", type(e).__name__)
                subtitle_path = None
                subtitle_error = "Local Whisper subtitle generation failed. Please go to Settings -> Default model -> Speech-to-subtitle to confirm the model is downloaded, and check that the video has a playable audio track."
        
        logger.info(f"Download complete - video file: {video_path}, subtitle file: {subtitle_path}")
        
        # Update project info (project created at start)
        from ...services.project_service import ProjectService
        from ...core.database import SessionLocal
        
        saved_project_id = None
        db = SessionLocal()
        try:
            project_service = ProjectService(db)
            
            # Get the created project
            project = project_service.get(project_id)
            if not project:
                raise Exception(f"Project {project_id} does not exist")
            
            # Update project info
            project.description = f"Downloaded from YouTube: {request.project_name}"
            # Note: do not set video_path here; set it after the file is moved
            
            # Update project settings. Assign a new dict to avoid JSON in-place mutation being lost on commit.
            from ...services.download_progress import save_processing_config
            save_processing_config(project, {
                "youtube_info": {
                    "title": request.project_name,
                    "uploader": "YouTube",
                    "duration": 0,
                    "view_count": 0,
                    "like_count": 0
                },
                "subtitle_path": subtitle_path,
                "download_status": "completed",
                "download_progress": 100.0
            })
            
            # Move files into project directory
            from ...core.path_utils import get_project_directory
            project_dir = get_project_directory(project_id)
            raw_dir = project_dir / "raw"
            raw_dir.mkdir(parents=True, exist_ok=True)
            
            # Move video file into project directory
            import shutil
            
            if video_path:
                video_file_path = Path(video_path)
                if video_file_path.exists():
                    # Rename video file to input.mp4
                    new_video_path = raw_dir / "input.mp4"
                    shutil.move(str(video_file_path), str(new_video_path))
                    logger.info(f"Video file moved to: {new_video_path}")
                    
                    # Update video path in project
                    project.video_path = str(new_video_path)
            
            # Move subtitle file into project directory
            if subtitle_path:
                subtitle_file_path = Path(subtitle_path)
                if subtitle_file_path.exists():
                    # Rename subtitle file to input.srt
                    new_subtitle_path = raw_dir / "input.srt"
                    shutil.move(str(subtitle_file_path), str(new_subtitle_path))
                    logger.info(f"Subtitle file moved to: {new_subtitle_path}")
                    
                    # Update subtitle path in project processing config
                    from ...services.download_progress import save_processing_config
                    save_processing_config(project, {"subtitle_path": str(new_subtitle_path)})
            
            # Save project updates
            db.commit()
            
            # Check if subtitle file exists; if not, mark project as failed
            srt_file_path = raw_dir / "input.srt"
            if not srt_file_path.exists():
                logger.error(f"Subtitle file does not exist: {srt_file_path}, project will be marked as failed")
                from ...schemas.project import ProjectStatus
                project.status = ProjectStatus.FAILED
                from ...services.download_progress import save_processing_config
                save_processing_config(
                    project,
                    {"error_message": subtitle_error or "Subtitle file does not exist and Whisper generation failed"},
                )
                db.commit()
                
                # Update task status to failed
                download_tasks[task_id].status = "failed"
                download_tasks[task_id].error_message = subtitle_error or "Subtitle file does not exist and Whisper generation failed"
                download_tasks[task_id].progress = 0.0
                download_tasks[task_id].project_id = str(project.id)
                download_tasks[task_id].updated_at = datetime.now().isoformat()
                
                # Update project download progress to failed
                await update_project_download_progress(project_id, 0.0, "Download failed: subtitle file does not exist")
                
                logger.info(f"YouTube download task failed: {task_id}, project ID: {project.id}, reason: subtitle file does not exist")
                return
            
            # Update project download progress to complete
            await update_project_download_progress(project_id, 100.0, "Download complete, preparing to process")
            
            # Update task status
            download_tasks[task_id].status = "completed"
            download_tasks[task_id].progress = 100.0
            download_tasks[task_id].project_id = str(project.id)
            download_tasks[task_id].updated_at = datetime.now().isoformat()
            
            logger.info(f"YouTube download task complete: {task_id}, project ID: {project.id}")

            from ...schemas.project import ProjectStatus
            project.status = ProjectStatus.PENDING
            db.commit()

            logger.info(f"YouTube project {project.id} download complete, waiting for automated pipeline to start")
            saved_project_id = str(project.id)

        except Exception as e:
            logger.error(f"Failed to create project: {str(e)}")
            # Even if processing start fails, still return download success
            # User can restart processing via the retry button
            saved_project_id = None

        finally:
            db.close()

        if saved_project_id:
            try:
                from ...services.auto_pipeline_service import auto_pipeline_service
                pipeline_result = await auto_pipeline_service.auto_start_pipeline(saved_project_id)
                if pipeline_result['status'] == 'started':
                    logger.info(f"YouTube project {saved_project_id} automated pipeline started: {pipeline_result}")
                else:
                    logger.warning(f"YouTube project {saved_project_id} automated pipeline start result: {pipeline_result}")
            except Exception as e:
                logger.error(f"Failed to start automated pipeline for YouTube project {saved_project_id}: {str(e)}")
                # Even if processing start fails, still return download success
                # User can restart processing via the retry button
            
    except Exception as e:
        logger.error(f"Failed to process download task: {str(e)}")
        download_tasks[task_id].status = "failed"
        download_tasks[task_id].error_message = str(e)
        download_tasks[task_id].progress = 0.0
        download_tasks[task_id].updated_at = datetime.now().isoformat()


async def _try_youtube_subtitle_strategies(url: str, download_dir: Path, browser: Optional[str] = None) -> str:
    """Attempt multiple YouTube subtitle acquisition strategies"""
    strategies = [
        lambda: _try_download_with_different_formats(url, download_dir, browser),
        lambda: _try_download_with_different_langs(url, download_dir, browser),
        lambda: _try_extract_from_metadata(url, download_dir, browser)
    ]
    
    for strategy in strategies:
        try:
            subtitle_path = await strategy()
            if subtitle_path:
                logger.info(f"YouTube fallback subtitle strategy succeeded")
                return subtitle_path
        except Exception as e:
            logger.warning(f"YouTube fallback subtitle strategy failed: {e}")
            continue
    
    logger.warning("All YouTube subtitle strategies failed")
    return ""


async def _try_download_with_different_formats(url: str, download_dir: Path, browser: Optional[str] = None) -> str:
    """Attempt to download subtitles in different formats"""
    import asyncio
    logger.info("Attempting to download YouTube subtitles in different formats...")
    
    formats = ['srt', 'vtt', 'json3']
    
    for fmt in formats:
        try:
            ydl_opts = {
                'skip_download': True,  # video already downloaded; only fetch subtitles here
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': get_subtitle_langs(),
                'subtitlesformat': fmt,
                'outtmpl': str(download_dir / f'subtitle_%(title)s.%(ext)s'),
                'noplaylist': True,
                'quiet': True,
                'ignoreconfig': True,
                'config_locations': [],
                **ytdlp_ffmpeg_options(),
            }
            
            if browser:
                ydl_opts['cookiesfrombrowser'] = (browser.lower(),)
            
            def download_sync(url, ydl_opts):
                with sanitized_yt_env():
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        return ydl.download([url])
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, download_sync, url, ydl_opts)
            
            # Locate downloaded subtitle files
            subtitle_files = list(download_dir.glob(f"*.{fmt}"))
            if subtitle_files:
                subtitle_path = str(subtitle_files[0])
                
                # If VTT format, convert to SRT
                if fmt == 'vtt':
                    srt_path = subtitle_path.replace('.vtt', '.srt')
                    await _convert_vtt_to_srt(subtitle_path, srt_path)
                    return srt_path
                
                return subtitle_path
                
        except Exception as e:
            logger.debug(f"Attempt for format {fmt} failed: {e}")
            continue
    
    return ""


async def _try_download_with_different_langs(url: str, download_dir: Path, browser: Optional[str] = None) -> str:
    """Attempt to download subtitles in different languages"""
    import asyncio
    logger.info("Attempting to download YouTube subtitles in different languages...")
    
    lang_combinations = [
        ['en', 'en-US'],      # English
        ['zh-Hans', 'zh'],    # Chinese
        ['ja', 'ja-JP'],      # Japanese
        ['ko', 'ko-KR'],      # Korean
        ['auto']              # auto-detect
    ]
    
    for langs in lang_combinations:
        try:
            ydl_opts = {
                'skip_download': True,  # video already downloaded; only fetch subtitles here
                'writesubtitles': True,
                'writeautomaticsub': True,
                'subtitleslangs': langs,
                'subtitlesformat': 'srt',
                **ytdlp_ffmpeg_options(),
                'outtmpl': str(download_dir / f'lang_%(title)s.%(ext)s'),
                'noplaylist': True,
                'quiet': True,
                'ignoreconfig': True,
                'config_locations': [],
            }
            
            if browser:
                ydl_opts['cookiesfrombrowser'] = (browser.lower(),)
            
            def download_sync(url, ydl_opts):
                with sanitized_yt_env():
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        return ydl.download([url])
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, download_sync, url, ydl_opts)
            
            # Locate downloaded subtitle files
            subtitle_files = list(download_dir.glob("*.srt"))
            if subtitle_files:
                return str(subtitle_files[0])
                
        except Exception as e:
            logger.debug(f"Attempt for language {langs} failed: {e}")
            continue
    
    return ""


async def _try_extract_from_metadata(url: str, download_dir: Path, browser: Optional[str] = None) -> str:
    """Attempt to extract subtitle info from video metadata"""
    import asyncio
    logger.info("Attempting to extract subtitle info from YouTube video metadata...")
    
    try:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'ignoreconfig': True,
            'config_locations': [],
        }
        
        if browser:
            ydl_opts['cookiesfrombrowser'] = (browser.lower(),)
        
        def extract_info_sync(url, ydl_opts):
            with sanitized_yt_env():
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    return ydl.extract_info(url, download=False)
        
        loop = asyncio.get_event_loop()
        info_dict = await loop.run_in_executor(None, extract_info_sync, url, ydl_opts)
        
        # Check whether subtitle info exists
        subtitles = info_dict.get('subtitles', {})
        auto_subtitles = info_dict.get('automatic_captions', {})
        
        if subtitles or auto_subtitles:
            logger.info(f"Found YouTube subtitle info: {list(subtitles.keys()) + list(auto_subtitles.keys())}")
            # Subtitle info could be processed further here, but we currently return an empty string
            return ""
        
        return ""
        
    except Exception as e:
        logger.debug(f"Failed to extract YouTube video metadata: {e}")
        return ""


async def _convert_vtt_to_srt(vtt_path: str, srt_path: str):
    """Convert a VTT subtitle file to SRT format"""
    try:
        with open(vtt_path, 'r', encoding='utf-8') as vtt_file:
            vtt_content = vtt_file.read()
        
        # Simple VTT-to-SRT conversion
        lines = vtt_content.split('\n')
        srt_lines = []
        subtitle_count = 1
        
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            
            # Skip VTT header info
            if line.startswith('WEBVTT') or line.startswith('NOTE') or not line:
                i += 1
                continue
            
            # Locate timestamp lines
            if '-->' in line:
                # Convert time format (VTT uses dots, SRT uses commas)
                time_line = line.replace('.', ',')
                srt_lines.append(str(subtitle_count))
                srt_lines.append(time_line)
                
                # Get subtitle text
                i += 1
                subtitle_text = []
                while i < len(lines) and lines[i].strip():
                    subtitle_text.append(lines[i].strip())
                    i += 1
                
                srt_lines.extend(subtitle_text)
                srt_lines.append('')  # blank line separator
                subtitle_count += 1
            
            i += 1
        
        # Write SRT file
        with open(srt_path, 'w', encoding='utf-8') as srt_file:
            srt_file.write('\n'.join(srt_lines))
            
        logger.info(f"VTT to SRT conversion succeeded: {vtt_path} -> {srt_path}")
        
    except Exception as e:
        logger.error(f"VTT to SRT conversion failed: {e}")
        raise
