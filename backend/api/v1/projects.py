"""
Project API routes
"""

import logging
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from backend.core.database import get_db
from backend.services.project_service import ProjectService
from backend.services.processing_service import ProcessingService
from backend.services.websocket_notification_service import WebSocketNotificationService
# Deferred imports to avoid triggering the celery_app import chain too early
# from backend.tasks.processing import process_video_pipeline
from backend.core.websocket_manager import manager as websocket_manager
from backend.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse, ProjectFilter,
    ProjectType, ProjectStatus
)
from backend.schemas.base import PaginationParams
from pathlib import Path

logger = logging.getLogger(__name__)
router = APIRouter()


def get_project_service(db: Session = Depends(get_db)) -> ProjectService:
    """Dependency to get project service."""
    return ProjectService(db)


def get_processing_service(db: Session = Depends(get_db)) -> ProcessingService:
    """Dependency to get processing service."""
    return ProcessingService(db)


def get_websocket_service():
    """Dependency to get websocket notification service."""
    return WebSocketNotificationService


async def _transcription_gate(video_path, srt_path) -> None:
    from backend.api.v1 import transcription_gate
    await transcription_gate.for_paths(video_path, srt_path)  # off the event loop


async def _stage_for_gate(video_file: UploadFile, *, has_srt: bool):
    """Run the import gate; returns the staged upload path when the file had to be probed, else None."""
    return await stage_for_gate(video_file, b'', Path(video_file.filename or '').suffix.lower() or '.mp4',
                                srt_available=has_srt, route='content')


from .studio import stage_upload, _stage_for_gate as stage_for_gate  # noqa: E402


@router.post("/upload", response_model=ProjectResponse)
async def upload_files(
    video_file: UploadFile = File(...),
    srt_file: Optional[UploadFile] = File(None),
    project_name: str = Form(...),
    video_category: Optional[str] = Form(None),
    project_service: ProjectService = Depends(get_project_service)
):
    """Upload video file and optional subtitle file to create a new project. If no subtitle is provided, Whisper will automatically generate one."""
    try:
        # Validate video file type
        if not video_file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv', '.webm')):
            raise HTTPException(status_code=400, detail="Invalid video file format")
        
        # Validate subtitle file type (if provided)
        if srt_file and not srt_file.filename.lower().endswith('.srt'):
            raise HTTPException(status_code=400, detail="Invalid subtitle file format")
        
        # Create project data
        subtitle_info = srt_file.filename if srt_file else "Whisper auto-generated"
        project_data = ProjectCreate(
            name=project_name,
            description=f"Video: {video_file.filename}, Subtitle: {subtitle_info}",
            project_type=ProjectType.KNOWLEDGE,  # default type
            status=ProjectStatus.PENDING,
            source_url=None,
            source_file=video_file.filename,
            settings={
                "video_category": video_category or "knowledge",
                "video_file": video_file.filename,
                "srt_file": subtitle_info
            }
        )
        
        # 1.5.7: local Whisper selected but missing/installing and no subtitle -> refuse before creating a project.
        staged = await _stage_for_gate(video_file, has_srt=bool(srt_file))

        # Create the project and write it to disk. From staging success through the move is in one try:
        # any failure deletes the staged file.
        try:
            project = project_service.create_project(project_data)

            # Save files to the project directory
            project_id = str(project.id)
            from ...core.path_utils import get_project_raw_directory
            raw_dir = get_project_raw_directory(project_id)

            # Save the video file
            video_path = raw_dir / "input.mp4"
            if staged is not None:
                import shutil
                shutil.move(str(staged), str(video_path))
            else:
                with open(video_path, "wb") as f:
                    content = await video_file.read()
                    f.write(content)
        except BaseException:
            if staged is not None:
                staged.unlink(missing_ok=True)
            raise
        
        # Update the project's video path
        project.video_path = str(video_path)
        project_service.db.commit()
        
        # Generate thumbnail immediately (synchronous)
        try:
            from ...utils.thumbnail_generator import generate_project_thumbnail
            logger.info(f"Generating thumbnail for project {project_id}...")
            thumbnail_data = generate_project_thumbnail(project_id, video_path)
            if thumbnail_data:
                project.thumbnail = thumbnail_data
                project_service.db.commit()
                logger.info(f"Thumbnail generated and saved for project {project_id}")
            else:
                logger.warning(f"Failed to generate thumbnail for project {project_id}")
        except Exception as e:
            logger.error(f"Error generating project thumbnail: {e}")
            # Thumbnail failure does not affect the main flow; it will be retried in an async task
        
        # Handle the subtitle file (if provided by the user)
        srt_path = None
        if srt_file:
            # User provided a subtitle file
            srt_path = raw_dir / "input.srt"
            with open(srt_path, "wb") as f:
                content = await srt_file.read()
                f.write(content)
            logger.info(f"User-provided subtitle file saved: {srt_path}")
        
        # Start the async processing task
        try:
            from ...tasks.import_processing import process_import_task
            
            # Check whether an identical project is already processing
            from ...models.task import Task, TaskStatus
            # This previously used a bare `db` (undefined); the NameError was swallowed by the except below,
            # so locally uploaded projects never auto-started processing and stayed pending until a manual click.
            existing_task = project_service.db.query(Task).filter(
                Task.project_id == project_id,
                Task.status == TaskStatus.RUNNING,
                Task.name.like('%import%')
            ).first()
            
            if existing_task:
                logger.warning(f"Project {project_id} already has a running task, skipping duplicate start")
            else:
                # Submit the async task
                celery_task = process_import_task.delay(
                    project_id=project_id,
                    video_path=str(video_path),
                    srt_file_path=str(srt_path) if srt_path else None
                )
                
                logger.info(f"Async processing task started for project {project_id}, Celery task ID: {celery_task.id}")
            
        except Exception as e:
            logger.error(f"Failed to start async processing for project {project_id}: {str(e)}")
            # Even if the async task fails to start, return project creation success
            # The user can restart processing via the retry button
        
        # Return the project response
        response_data = {
            "id": str(project.id),
            "name": str(project.name),
            "description": str(project.description) if project.description else None,
            "project_type": ProjectType(project.project_type.value),
            "status": ProjectStatus(project.status.value),
            "source_url": project.project_metadata.get("source_url") if project.project_metadata else None,
            "source_file": str(project.video_path) if project.video_path else None,
            "video_path": str(video_path),  # add video_path field
            "settings": {
                "video_category": video_category or "knowledge",
                "video_file": video_file.filename,
                "srt_file": subtitle_info
            },  # only include serializable data
            "created_at": project.created_at,
            "updated_at": project.updated_at,
            "completed_at": project.completed_at,
            "total_clips": 0,
            "total_collections": 0,
            "total_tasks": 0
        }
        
        # Thumbnail will be generated in the async task
        response_data["thumbnail"] = None
        
        return ProjectResponse(**response_data)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to create project from upload")
        raise HTTPException(status_code=500, detail="Failed to create project, please try again later")


@router.post("/", response_model=ProjectResponse)
async def create_project(
    project_data: ProjectCreate,
    project_service: ProjectService = Depends(get_project_service)
):
    """Create a new project."""
    try:
        project = project_service.create_project(project_data)
        # Convert to response (simplified for now)
        return ProjectResponse(
            id=str(project.id),  # Use actual project ID
            name=str(project.name),
            description=str(project.description) if project.description else None,
            project_type=ProjectType(project.project_type.value),
            status=ProjectStatus(project.status.value),
            source_url=project.project_metadata.get("source_url") if project.project_metadata else None,
            source_file=str(project.video_path) if project.video_path else None,
            settings=project.processing_config or {},
            created_at=project.created_at,
            updated_at=project.updated_at,
            completed_at=project.completed_at,
            total_clips=0,
            total_collections=0,
            total_tasks=0
        )
    except Exception as e:
        logger.exception("Failed to create project")
        raise HTTPException(status_code=500, detail="Failed to create project, please try again later")


@router.get("/", response_model=ProjectListResponse)
async def get_projects(
    page: int = Query(1, ge=1, description="Page number"),
    size: int = Query(20, ge=1, le=100, description="Page size"),
    status: Optional[str] = Query(None, description="Filter by status"),
    project_type: Optional[str] = Query(None, description="Filter by project type"),
    search: Optional[str] = Query(None, description="Search in name and description"),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get paginated projects with optional filtering."""
    try:
        pagination = PaginationParams(page=page, size=size)
        
        filters = None
        if status or project_type or search:
            # Convert strings to enum values
            status_enum = None
            if status:
                try:
                    status_enum = ProjectStatus(status)
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid status: {status}")
            
            project_type_enum = None
            if project_type:
                try:
                    project_type_enum = ProjectType(project_type)
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid project_type: {project_type}")
            
            filters = ProjectFilter(
                status=status_enum,
                project_type=project_type_enum,
                search=search
            )
        
        return project_service.get_projects_paginated(pagination, filters)
    except Exception as e:
        logger.exception("Failed to get project list")
        raise HTTPException(status_code=500, detail="Failed to get project list, please try again later")


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    include_clips: bool = Query(False, description="Whether to include clip data"),
    include_collections: bool = Query(False, description="Whether to include collection data"),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get a project by ID."""
    try:
        project = project_service.get_project_with_stats(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Load clips and collections data if requested
        clips_data = None
        collections_data = None
        
        if include_clips or include_collections:
            from ...services.clip_service import ClipService
            from ...services.collection_service import CollectionService

            # Reuse this request's session. Fetching a separate generator would drop the finally, and the connection would not be returned (#175).
            db = project_service.db

            if include_clips:
                clip_service = ClipService(db)
                clips = clip_service.get_multi(filters={"project_id": project_id})
                # Convert to dict format
                clips_data = [clip.to_dict() if hasattr(clip, 'to_dict') else clip.__dict__ for clip in clips]
            
            if include_collections:
                collection_service = CollectionService(db)
                collections = collection_service.get_multi(filters={"project_id": project_id})
                # Convert to dict format
                collections_data = [collection.to_dict() if hasattr(collection, 'to_dict') else collection.__dict__ for collection in collections]
        
        # Build response data including clips and collections
        response_data = project.model_dump() if hasattr(project, 'model_dump') else project.__dict__
        if clips_data is not None:
            response_data['clips'] = clips_data
        if collections_data is not None:
            response_data['collections'] = collections_data
        
        # Return the updated response
        return ProjectResponse(**response_data)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get project details: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to get project details, please try again later")


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    project_data: ProjectUpdate,
    project_service: ProjectService = Depends(get_project_service)
):
    """Update a project."""
    try:
        project = project_service.update_project(project_id, project_data)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Convert to response (simplified)
        return ProjectResponse(
            id=str(project_id),  # Keep as string for UUID
            name=project_data.name or "Updated Project",
            description=project_data.description,
            project_type=ProjectType.DEFAULT,  # Use enum
            status=ProjectStatus.PENDING,  # Use enum
            source_url=None,
            source_file=None,
            settings=project_data.settings or {},
            created_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
            completed_at=None,
            total_clips=0,
            total_collections=0,
            total_tasks=0
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to update project: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to update project, please try again later")


@router.delete("/{project_id}")
async def delete_project(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Delete a project and all its related files."""
    try:
        success = project_service.delete_project_with_files(project_id)
        if not success:
            raise HTTPException(status_code=404, detail="Project not found")
        return {"message": "Project and all related files deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to delete project: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to delete project, please try again later")


@router.post("/sync-all-data")
async def sync_all_projects_data(
    db: Session = Depends(get_db)
):
    """Sync all project data to the database"""
    try:
        from ...services.data_sync_service import DataSyncService
        from ...core.config import get_data_directory
        
        data_dir = get_data_directory()
        sync_service = DataSyncService(db)
        
        result = sync_service.sync_all_projects_from_filesystem(data_dir)
        
        return {
            "message": "Data sync complete",
            "result": result
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data sync failed: {str(e)}")


@router.post("/{project_id}/sync-data")
async def sync_project_data(
    project_id: str,
    db: Session = Depends(get_db)
):
    """Sync specified project data to the database"""
    try:
        from ...services.data_sync_service import DataSyncService
        from ...core.path_utils import get_project_directory
        
        project_dir = get_project_directory(project_id)
        if not project_dir.exists():
            raise HTTPException(status_code=404, detail="Project directory not found")
        
        sync_service = DataSyncService(db)
        result = sync_service.sync_project_from_filesystem(project_id, project_dir)
        
        if result.get("success"):
            return {
                "message": "Project data synced successfully",
                "result": result
            }
        else:
            raise HTTPException(status_code=500, detail=f"Data sync failed: {result.get('error')}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Data sync failed: {str(e)}")


@router.post("/{project_id}/process")
async def start_processing(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service),
    processing_service: ProcessingService = Depends(get_processing_service),
    websocket_service: WebSocketNotificationService = Depends(get_websocket_service)
):
    """Start processing a project using Celery task queue."""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check project status
        if project.status.value not in ["pending", "failed"]:
            raise HTTPException(status_code=400, detail="Project is not in pending or failed status")
        
        # Get video and SRT file paths
        video_path = project.video_path
        srt_path = None
        
        # Get SRT file path from processing_config
        if project.processing_config and "subtitle_path" in project.processing_config:
            srt_path = project.processing_config["subtitle_path"]
        
        # Verify the video file exists
        if not video_path or not Path(video_path).exists():
            raise HTTPException(status_code=400, detail=f"Video file not found: {video_path}")
        
        # If there is no SRT path, try to auto-locate
        if not srt_path:
            video_dir = Path(video_path).parent
            srt_file = video_dir / "input.srt"
            if srt_file.exists():
                srt_path = str(srt_file)
            else:
                # SRT file is optional; set to None if not found
                srt_path = None
        elif not Path(srt_path).exists():
            # If the specified SRT file does not exist, try auto-locating
            video_dir = Path(video_path).parent
            srt_file = video_dir / "input.srt"
            if srt_file.exists():
                srt_path = str(srt_file)
            else:
                srt_path = None

        await _transcription_gate(video_path, srt_path)
        
        # Update project status to processing
        project_service.update_project_status(project_id, "processing")
        
        # Send WebSocket notification: processing started
        await websocket_service.send_processing_started(
            project_id=project_id,
            message="Starting video processing"
        )
        
        # Deferred imports to avoid triggering the celery_app import chain too early
        from backend.tasks.processing import process_video_pipeline
        
        # Submit the Celery task
        celery_task = process_video_pipeline.delay(
            project_id=project_id,
            input_video_path=str(video_path),
            input_srt_path=str(srt_path) if srt_path else None
        )
        
        # Create the processing task record
        task_result = processing_service._create_processing_task(
            project_id=project_id,
            task_type="VIDEO_PROCESSING"
        )
        
        return {
            "message": "Processing started successfully",
            "project_id": project_id,
            "task_id": task_result.id,
            "celery_task_id": celery_task.id,
            "status": "processing"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        # Send error notification
        try:
            await websocket_service.send_processing_error(
                project_id=int(project_id),
                error=str(e),
                step="initialization"
            )
        except:
            pass
        logger.exception("Failed to start project processing: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to start processing, please try again later")


@router.post("/{project_id}/retry")
async def retry_processing(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service),
    processing_service: ProcessingService = Depends(get_processing_service),
    websocket_service: WebSocketNotificationService = Depends(get_websocket_service)
):
    """Retry processing a project from the beginning."""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check project status - allow retry for failed, completed, processing, pending
        if project.status.value not in ["failed", "completed", "processing", "pending"]:
            raise HTTPException(status_code=400, detail="Project is not in failed, completed, processing, or pending status")
        from backend.api.v1 import transcription_gate
        await transcription_gate.for_project(project_id)  # gate before touching project status, off the loop
        
        # Reset project status
        project_service.update_project_status(project_id, "pending")
        
        # Send WebSocket notification - WebSocket notifications disabled
        # await websocket_service.send_processing_started(
        #     project_id=int(project_id),
        #     message="Restarting processing"
        # )
        
        # Get file paths and resubmit the task
        from ...core.path_utils import get_project_raw_directory
        raw_dir = get_project_raw_directory(project_id)
        video_path = raw_dir / "input.mp4"  # use the standard input.mp4 filename
        srt_path = raw_dir / "input.srt"    # use the standard input.srt filename
        
        # Check whether the video file exists; if not, try to re-download
        if not video_path.exists():
            logger.warning(f"Video file not found: {video_path}, trying to re-download")
            
            # Check whether there is a source URL in the project metadata
            if hasattr(project, 'project_metadata') and project.project_metadata:
                source_url = project.project_metadata.get('source_url')
                if source_url:
                    logger.info(f"Found source URL: {source_url}, starting re-download")
                    
                    # Choose the download method based on URL type
                    if 'bilibili.com' in source_url:
                        # Re-download Bilibili video
                        from .bilibili import process_download_task, BilibiliDownloadRequest, BilibiliDownloadTask, download_tasks
                        import uuid
                        
                        # Create download request
                        download_request = BilibiliDownloadRequest(
                            url=source_url,
                            project_name=project.name,
                            video_category=project.project_metadata.get('category', 'general')
                        )
                        
                        # Generate a new task ID
                        download_task_id = str(uuid.uuid4())
                        
                        # Create the task record
                        task = BilibiliDownloadTask(
                            id=download_task_id,
                            url=source_url,
                            project_name=project.name,
                            video_category=project.project_metadata.get('category', 'general'),
                            status="pending",
                            progress=0.0,
                            project_id=project_id,
                            created_at=str(uuid.uuid1().time),
                            updated_at=str(uuid.uuid1().time)
                        )
                        
                        # Store the task
                        download_tasks[download_task_id] = task
                        
                        # Start the download task asynchronously
                        from .async_task_manager import task_manager
                        await task_manager.create_safe_task(
                            f"bilibili_redownload_{download_task_id}",
                            process_download_task,
                            download_task_id,
                            download_request,
                            project_id
                        )
                        
                        return {
                            "message": "Video file not found, started re-downloading Bilibili video",
                            "project_id": project_id,
                            "download_task_id": download_task_id,
                            "source_url": source_url
                        }
                    elif 'youtube.com' in source_url or 'youtu.be' in source_url:
                        # Re-download YouTube video
                        from .youtube import process_youtube_download_task, YouTubeDownloadRequest
                        import uuid
                        
                        # Create download request
                        download_request = YouTubeDownloadRequest(
                            url=source_url,
                            project_name=project.name,
                            video_category=project.project_metadata.get('category', 'general')
                        )
                        
                        # Generate a new task ID
                        download_task_id = str(uuid.uuid4())
                        
                        # Start the download task asynchronously
                        from .async_task_manager import task_manager
                        await task_manager.create_safe_task(
                            f"youtube_redownload_{download_task_id}",
                            process_youtube_download_task,
                            download_task_id,
                            download_request,
                            project_id
                        )
                        
                        return {
                            "message": "Video file not found, started re-downloading YouTube video",
                            "project_id": project_id,
                            "download_task_id": download_task_id,
                            "source_url": source_url
                        }
                    else:
                        raise HTTPException(status_code=400, detail=f"Unsupported video source: {source_url}")
                else:
                    raise HTTPException(status_code=400, detail=f"Video file not found and no source URL: {video_path}")
            else:
                raise HTTPException(status_code=400, detail=f"Video file not found and no project metadata: {video_path}")
        
        # Subtitle file is optional
        srt_path_str = str(srt_path) if srt_path.exists() else None
        await _transcription_gate(video_path, srt_path_str)
        
        # Deferred imports to avoid triggering the celery_app import chain too early
        from backend.tasks.processing import process_video_pipeline
        
        # Submit the Celery task - using string project_id
        celery_task = process_video_pipeline.delay(
            project_id=project_id,
            input_video_path=str(video_path),
            input_srt_path=srt_path_str
        )
        
        # Create a new processing task record
        from ...models.task import TaskType
        task_result = processing_service._create_processing_task(
            project_id=project_id,
            task_type=TaskType.VIDEO_PROCESSING
        )
        
        # Update the task's Celery task ID
        task_result.celery_task_id = celery_task.id
        processing_service.db.commit()
        
        return {
            "message": "Processing retry started successfully",
            "project_id": project_id,
            "task_id": task_result.id,
            "celery_task_id": celery_task.id,
            "status": "processing"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        # Send error notification - WebSocket notifications disabled
        # try:
        #     await websocket_service.send_processing_error(
        #         project_id=int(project_id),
        #         error=str(e),
        #         step="retry_initialization"
        #     )
        # except:
        #     pass
        logger.exception("Failed to retry project processing: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to retry processing, please try again later")


@router.post("/{project_id}/resume")
async def resume_processing(
    project_id: str,
    start_step: str = Form(..., description="Step to resume from (step1_outline, step2_timeline, etc.)"),
    project_service: ProjectService = Depends(get_project_service),
    processing_service: ProcessingService = Depends(get_processing_service)
):
    """Resume processing from a specific step."""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check project status
        if project.status.value not in ["failed", "processing", "pending"]:
            raise HTTPException(status_code=400, detail="Project is not in failed, processing, or pending status")
        
        # Get the SRT file path (if needed)
        srt_path = None
        if start_step == "step1_outline":
            if project.processing_config and "srt_file" in project.processing_config:
                from pathlib import Path
                project_root = Path(__file__).parent.parent.parent / "data" / "projects" / project_id
                srt_path = project_root / "raw" / project.processing_config["srt_file"]
            
            if not srt_path or not srt_path.exists():
                raise HTTPException(status_code=400, detail=f"SRT file not found: {srt_path}")
        
        # Call the processing service to resume
        result = processing_service.resume_processing(project_id, start_step, srt_path)
        
        return {
            "message": f"Processing resumed from {start_step} successfully",
            "project_id": project_id,
            "start_step": start_step,
            "result": result
        }
    except Exception as e:
        logger.exception("Failed to resume project processing: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to resume processing, please try again later")


@router.get("/{project_id}/status")
async def get_processing_status(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service),
    processing_service: ProcessingService = Depends(get_processing_service)
):
    """Get processing status of a project."""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get the latest task
        tasks = project.tasks if hasattr(project, 'tasks') else []
        latest_task = None
        if tasks:
            latest_task = max(tasks, key=lambda t: t.created_at) if hasattr(tasks[0], 'created_at') else tasks[0]
        
        if not latest_task:
            return {
                "status": "pending",
                "current_step": 0,
                "total_steps": 6,
                "step_name": "Waiting to start",
                "progress": 0,
                "error_message": None
            }
        
        # Get processing status
        status = processing_service.get_processing_status(project_id, str(latest_task.id))
        
        return status
    except HTTPException:
        # Expected responses like 404 are returned as-is. Logging them as exceptions would make Sentry treat
        # them as faults, and wrapping them in a 500 would make the processing page retry "project not found" forever.
        raise
    except Exception:
        logger.exception("Failed to get processing status: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to get processing status, please try again later")


@router.get("/{project_id}/logs")
async def get_project_logs(
    project_id: str,
    lines: int = Query(50, ge=1, le=1000, description="Number of log lines to return"),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get project logs."""
    try:
        # Mock log data; should actually come from a log service
        return {
            "logs": [
                {
                    "timestamp": "2025-08-01T13:30:00.000Z",
                    "module": "processing",
                    "level": "INFO",
                    "message": "Started processing project"
                },
                {
                    "timestamp": "2025-08-01T13:30:05.000Z",
                    "module": "processing",
                    "level": "INFO",
                    "message": "Step 1: outline extraction complete"
                },
                {
                    "timestamp": "2025-08-01T13:30:10.000Z",
                    "module": "processing",
                    "level": "INFO",
                    "message": "Step 2: timeline positioning complete"
                },
                {
                    "timestamp": "2025-08-01T13:30:15.000Z",
                    "module": "processing",
                    "level": "INFO",
                    "message": "Step 3: content scoring in progress..."
                }
            ]
        }
    except Exception as e:
        logger.exception("Failed to get project logs: %s", project_id)
        raise HTTPException(status_code=500, detail="Failed to get project logs, please try again later")


@router.get("/{project_id}/import-status")
async def get_import_status(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get project import status"""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check for an ongoing import task
        from backend.celery_app import celery_app
        
        # More complex task status checking could be added here
        # Currently simply returns the project status
        return {
            "project_id": project_id,
            "status": project.status.value,
            "message": "Import status normal"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get import status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get import status: {str(e)}")


@router.post("/{project_id}/generate-thumbnail")
async def generate_project_thumbnail(
    project_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Generate thumbnail for project"""
    try:
        # Get project info
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Check whether there is a video file
        if not project.video_path:
            raise HTTPException(status_code=400, detail="Project has no video file")
        
        # Check whether the video file exists
        video_path = Path(project.video_path)
        if not video_path.exists():
            raise HTTPException(status_code=400, detail="Video file not found")
        
        # Generate thumbnail
        from ...utils.thumbnail_generator import generate_project_thumbnail
        thumbnail_data = generate_project_thumbnail(project_id, video_path)
        
        if thumbnail_data:
            # Save the thumbnail to the database
            project.thumbnail = thumbnail_data
            project_service.db.commit()
            
            return {
                "success": True,
                "thumbnail": thumbnail_data,
                "message": "Thumbnail generated and saved successfully"
            }
        else:
            raise HTTPException(status_code=500, detail="Failed to generate thumbnail")
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate project thumbnail: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate thumbnail: {str(e)}")


@router.get("/{project_id}/files/{filename}")
async def get_project_file(
    project_id: str,
    filename: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get a project file by filename."""
    try:
        from pathlib import Path
        import json
        from fastapi.responses import FileResponse
        
        # Build the file path - use the correct project directory path
        from ...core.path_utils import get_project_directory
        project_root = get_project_directory(project_id)
        
        # Try multiple possible paths
        possible_paths = [
            project_root / "raw" / filename,  # raw file
            project_root / "metadata" / filename,  # metadata file
            project_root / filename,  # directly in project root
        ]
        
        file_path = None
        for path in possible_paths:
            if path.exists():
                file_path = path
                break
        
        if not file_path:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Return different responses based on file type
        if filename.endswith('.json'):
            # JSON file returns data
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data
        else:
            # Other files (e.g. video) return a file stream
            media_type = "video/mp4" if filename.endswith('.mp4') else "application/octet-stream"
            return FileResponse(
                path=str(file_path),
                filename=filename,
                media_type=media_type,
                headers={
                    "Accept-Ranges": "bytes",  # support range requests for video playback
                    "Cache-Control": "public, max-age=3600"  # cache for 1 hour
                }
            )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get project file: %s/%s", project_id, filename)
        raise HTTPException(status_code=500, detail="Failed to get project file, please try again later")


@router.get("/{project_id}/clips/{clip_id}")
async def get_project_clip(
    project_id: str,
    clip_id: str,
    project_service: ProjectService = Depends(get_project_service)
):
    """Get a specific clip video file for a project."""
    try:
        from pathlib import Path
        import os
        
        # Build the video file path - use the correct project directory path
        from ...core.path_utils import get_project_directory
        project_dir = get_project_directory(project_id)
        clips_dir = project_dir / "output" / "clips"
        
        # Ensure the path exists
        if not clips_dir.exists():
            raise HTTPException(status_code=404, detail=f"Clips directory not found: {clips_dir}")
        
        # Locate the corresponding video file
        # First try to locate by clip_id
        video_files = list(clips_dir.glob(f"{clip_id}_*.mp4"))
        
        # If not found, try all mp4 files then match via the database
        if not video_files:
            from ...models.clip import Clip
            clip = project_service.db.query(Clip).filter(Clip.id == clip_id).first()
            if clip and clip.video_path:
                video_file_path = Path(clip.video_path)
                if video_file_path.exists():
                    video_file = video_file_path
                else:
                    raise HTTPException(status_code=404, detail=f"Clip video file not found for clip_id: {clip_id}")
            else:
                raise HTTPException(status_code=404, detail=f"Clip not found in database: {clip_id}")
        else:
            video_file = video_files[0]
        
        # Check whether the file exists
        if not video_file.exists():
            raise HTTPException(status_code=404, detail="Clip video file not found")
        
        # Inline playback. With the default attachment, macOS WKWebView's <video> will not play.
        # Do not hand the raw on-disk filename to FileResponse: response headers are latin-1 encoded,
        # and non-ASCII filenames such as Chinese would raise UnicodeEncodeError, failing the preview with 500.
        # Consistent with the download endpoint, only use RFC 5987 filename*.
        from fastapi.responses import FileResponse
        from ...utils.content_disposition import content_disposition_header
        return FileResponse(
            path=str(video_file),
            media_type="video/mp4",
            content_disposition_type="inline",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
                "Content-Disposition": content_disposition_header(video_file.name, "inline"),
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Failed to get project clip: %s/%s", project_id, clip_id)
        raise HTTPException(status_code=500, detail="Failed to get clip file, please try again later")


@router.post("/sync-all")
async def sync_all_projects_from_filesystem(
    db: Session = Depends(get_db)
):
    """Sync all project data from the file system to the database"""
    try:
        from backend.services.data_sync_service import DataSyncService
        from backend.core.config import get_data_directory
        
        # Get the data directory
        data_dir = get_data_directory()
        
        # Create the data sync service
        sync_service = DataSyncService(db)
        
        # Sync all projects
        result = sync_service.sync_all_projects_from_filesystem(data_dir)
        
        return {
            "success": result.get("success", False),
            "message": "Data sync complete",
            "synced_projects": result.get("synced_projects", []),
            "failed_projects": result.get("failed_projects", []),
            "total_synced": len(result.get("synced_projects", [])),
            "total_failed": len(result.get("failed_projects", []))
        }
        
    except Exception as e:
        logger.error(f"Failed to sync all project data: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.patch("/{project_id}/collections/{collection_id}/reorder")
async def reorder_collection_clips(
    project_id: str,
    collection_id: str,
    clip_ids: List[str],
    db: Session = Depends(get_db)
):
    """Reorder clips in a collection"""
    try:
        from backend.services.collection_service import CollectionService
        
        # Create the collection service
        collection_service = CollectionService(db)
        
        # Get the collection
        collection = collection_service.get(collection_id)
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        # Verify the collection belongs to the specified project
        if str(collection.project_id) != project_id:
            raise HTTPException(status_code=400, detail="Collection does not belong to the specified project")
        
        # Update clip_ids in collection_metadata
        metadata = getattr(collection, 'collection_metadata', {}) or {}
        metadata['clip_ids'] = clip_ids
        
        # Directly update the collection_metadata field in the database
        from sqlalchemy import update
        from backend.models.collection import Collection
        
        stmt = update(Collection).where(Collection.id == collection_id).values(
            collection_metadata=metadata
        )
        collection_service.db.execute(stmt)
        collection_service.db.commit()
        
        return {
            "message": "Collection clips reordered successfully",
            "clip_ids": clip_ids
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to reorder clips in collection {collection_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to reorder: {str(e)}")


@router.post("/sync/{project_id}")
async def sync_project_from_filesystem(
    project_id: str,
    db: Session = Depends(get_db)
):
    """Sync specified project data from the file system to the database"""
    try:
        from backend.services.data_sync_service import DataSyncService
        from backend.core.config import get_data_directory
        
        # Get the data directory
        data_dir = get_data_directory()
        project_dir = data_dir / "projects" / project_id
        
        if not project_dir.exists():
            raise HTTPException(status_code=404, detail=f"Project directory not found: {project_id}")
        
        # Create the data sync service
        sync_service = DataSyncService(db)
        
        # Sync the project data
        result = sync_service.sync_project_from_filesystem(project_id, project_dir)
        
        return {
            "success": result.get("success", False),
            "project_id": project_id,
            "clips_synced": result.get("clips_synced", 0),
            "collections_synced": result.get("collections_synced", 0),
            "message": f"Project {project_id} synced"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to sync project {project_id} data: {e}")
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@router.post("/{project_id}/collections/{collection_id}/generate")
async def generate_collection_video(
    project_id: str,
    collection_id: str,
    db: Session = Depends(get_db),
    project_service: ProjectService = Depends(get_project_service)
):
    """Generate collection video"""
    try:
        from ...models.collection import Collection
        from ...models.clip import Clip
        from ...utils.video_processor import VideoProcessor
        from ...core.path_utils import get_project_directory
        from pathlib import Path
        import json
        
        # Verify the project exists
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get the collection record
        collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        # Verify the collection belongs to this project
        if str(collection.project_id) != project_id:
            raise HTTPException(status_code=400, detail="Collection does not belong to the specified project")
        
        # Get the clip ID list of the collection
        metadata = getattr(collection, 'collection_metadata', {}) or {}
        clip_ids = metadata.get('clip_ids', [])
        
        if not clip_ids:
            raise HTTPException(status_code=400, detail="Collection does not contain any clips")
        
        # Get clip info and order by clip_ids
        clips_dict = {clip.id: clip for clip in db.query(Clip).filter(Clip.id.in_(clip_ids)).all()}
        if len(clips_dict) != len(clip_ids):
            raise HTTPException(status_code=400, detail="Some clips do not exist")
        
        # Get clips in the user-adjusted order
        ordered_clips = [clips_dict[clip_id] for clip_id in clip_ids if clip_id in clips_dict]
        
        # Get the project directory
        project_dir = get_project_directory(project_id)
        collections_dir = project_dir / "output" / "collections"
        collections_dir.mkdir(parents=True, exist_ok=True)
        
        # Prepare the clip video file paths in the user-adjusted order
        clips_dir = project_dir / "output" / "clips"
        clip_video_paths = []
        
        for clip in ordered_clips:
            if clip.video_path and Path(clip.video_path).exists():
                clip_video_paths.append(Path(clip.video_path))
            else:
                # Try to locate in the clips directory
                possible_paths = [
                    clips_dir / f"{clip.id}_*.mp4",
                    clips_dir / f"clip_{clip.id}.mp4",
                    clips_dir / f"{clip.id}.mp4"
                ]
                
                found = False
                for pattern in possible_paths:
                    if pattern.name.endswith('*'):
                        # Handle wildcard
                        matches = list(clips_dir.glob(pattern.name))
                        if matches:
                            clip_video_paths.append(matches[0])
                            found = True
                            break
                    else:
                        if pattern.exists():
                            clip_video_paths.append(pattern)
                            found = True
                            break
                
                if not found:
                    raise HTTPException(status_code=404, detail=f"Clip video file not found: {clip.id}")
        
        # Generate the collection video filename - use the collection title as the filename
        collection_name = collection.name or f"collection_{collection_id}"
        # Sanitize the filename using VideoProcessor.sanitize_filename
        from ...utils.video_processor import VideoProcessor
        safe_name = VideoProcessor.sanitize_filename(collection_name)
        output_filename = f"{safe_name}.mp4"
        output_path = collections_dir / output_filename
        
        # Create the collection using VideoProcessor
        video_processor = VideoProcessor(
            clips_dir=str(clips_dir),
            collections_dir=str(collections_dir)
        )
        success = video_processor.create_collection(clip_video_paths, output_path)
        
        if not success:
            raise HTTPException(status_code=500, detail="Failed to generate collection video")
        
        # Generate the collection cover
        thumbnail_path = None
        try:
            thumbnail_filename = f"{collection_id}_{safe_name}_thumbnail.jpg"
            thumbnail_path = collections_dir / thumbnail_filename
            
            # Extract the cover from the video (frame at second 5)
            thumbnail_success = video_processor.extract_thumbnail(output_path, thumbnail_path, time_offset=5)
            if thumbnail_success:
                collection.thumbnail_path = str(thumbnail_path)
                logger.info(f"Collection cover generated: {thumbnail_path}")
            else:
                logger.warning(f"Failed to generate collection cover: {collection_id}")
        except Exception as e:
            logger.error(f"Error generating collection cover: {e}")
        
        # Update the collection's export_path
        collection.export_path = str(output_path)
        db.commit()
        
        return {
            "success": True,
            "message": "Collection video generated successfully",
            "collection_id": collection_id,
            "output_path": str(output_path),
            "filename": output_filename
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to generate collection video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate collection video: {str(e)}")


@router.get("/{project_id}/download")
async def download_project_file(
    project_id: str,
    clip_id: Optional[str] = Query(None, description="Download specified clip"),
    collection_id: Optional[str] = Query(None, description="Download specified collection"),
    db: Session = Depends(get_db),
    project_service: ProjectService = Depends(get_project_service)
):
    """Download project file (clip or collection)"""
    try:
        from fastapi.responses import FileResponse
        from pathlib import Path
        
        # Verify the project exists
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        if collection_id:
            # Download collection video
            from ...models.collection import Collection
            collection = db.query(Collection).filter(Collection.id == collection_id).first()
            if not collection:
                raise HTTPException(status_code=404, detail="Collection not found")
            
            if not collection.export_path:
                raise HTTPException(status_code=404, detail="Collection video file not found")
            
            file_path = Path(collection.export_path)
            if not file_path.exists():
                raise HTTPException(status_code=404, detail="Collection video file not found")
            
            # Generate the download filename
            collection_name = collection.name or f"collection_{collection_id}"
            from ...utils.video_processor import VideoProcessor
            from ...utils.content_disposition import content_disposition_header
            safe_name = VideoProcessor.sanitize_filename(collection_name)
            filename = f"{safe_name}.mp4"

            return FileResponse(
                path=str(file_path),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": content_disposition_header(filename, "attachment")
                }
            )
        
        elif clip_id:
            # Download clip video
            from ...models.clip import Clip
            clip = db.query(Clip).filter(Clip.id == clip_id).first()
            if not clip:
                raise HTTPException(status_code=404, detail="Clip not found")
            
            if not clip.video_path:
                raise HTTPException(status_code=404, detail="Clip video file not found")
            
            file_path = Path(clip.video_path)
            if not file_path.exists():
                raise HTTPException(status_code=404, detail="Clip video file not found")
            
            # Generate the download filename
            clip_title = clip.title or f"clip_{clip_id}"
            from ...utils.video_processor import VideoProcessor
            from ...utils.content_disposition import content_disposition_header
            safe_name = VideoProcessor.sanitize_filename(clip_title)
            filename = f"{safe_name}.mp4"

            return FileResponse(
                path=str(file_path),
                media_type="video/mp4",
                headers={
                    "Content-Disposition": content_disposition_header(filename, "attachment")
                }
            )
        
        else:
            raise HTTPException(status_code=400, detail="Must specify clip_id or collection_id")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download file: {str(e)}")


@router.get("/{project_id}/collections/{collection_id}/thumbnail")
async def get_collection_thumbnail(
    project_id: str,
    collection_id: str,
    db: Session = Depends(get_db),
    project_service: ProjectService = Depends(get_project_service)
):
    """Get collection cover image"""
    try:
        from fastapi.responses import FileResponse
        from pathlib import Path
        
        # Verify the project exists
        project = project_service.get(project_id)
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get the collection record
        from ...models.collection import Collection
        collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        # Verify the collection belongs to this project
        if str(collection.project_id) != project_id:
            raise HTTPException(status_code=400, detail="Collection does not belong to the specified project")
        
        # Check whether a cover exists
        if not collection.thumbnail_path:
            raise HTTPException(status_code=404, detail="Collection cover not found")
        
        thumbnail_path = Path(collection.thumbnail_path)
        if not thumbnail_path.exists():
            raise HTTPException(status_code=404, detail="Collection cover file not found")
        
        return FileResponse(
            path=str(thumbnail_path),
            media_type="image/jpeg",
            headers={
                "Cache-Control": "public, max-age=3600"  # cache for 1 hour
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get collection cover: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get collection cover: {str(e)}")


# ---- Publish / export ---
from pydantic import BaseModel, Field


class ClipExportRequest(BaseModel):
    preset: str = Field("douyin", description="douyin / xiaohongshu / shorts / bilibili / original / 1080p60")
    subtitles: bool = True
    title_card: bool = True
    layout: Optional[str] = Field(None, description="Override preset aspect: blur / crop / fit / none")


@router.get("/{project_id}/export-presets")
async def list_export_presets(project_id: str):
    from backend.services.publish_export import list_presets
    return {"presets": list_presets()}


@router.post("/{project_id}/clips/{clip_id}/export")
async def start_clip_export(project_id: str, clip_id: str, body: ClipExportRequest = ClipExportRequest()):
    from backend.services.publish_export import ExportRequest, start_export, load_clip_meta
    try:
        load_clip_meta(project_id, clip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return start_export(ExportRequest(
        project_id=project_id, clip_id=clip_id, preset=body.preset,
        subtitles=body.subtitles, title_card=body.title_card, layout=body.layout,
    ))


@router.get("/{project_id}/exports/{job_id}")
async def get_clip_export_job(project_id: str, job_id: str):
    from backend.services.publish_export import get_export_job
    job = get_export_job(job_id)
    if not job or job.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="No such export task")
    return job


@router.get("/{project_id}/exports/{job_id}/download")
async def download_clip_export(project_id: str, job_id: str):
    from fastapi.responses import FileResponse
    from backend.services.publish_export import get_export_job
    job = get_export_job(job_id)
    if not job or job.get("project_id") != project_id:
        raise HTTPException(status_code=404, detail="No such export task")
    if job.get("status") != "completed" or not (job.get("result") or {}).get("path"):
        raise HTTPException(status_code=409, detail="Export not completed yet")
    path = Path(job["result"]["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="Export file not found")
    return FileResponse(path=str(path), media_type="video/mp4", filename=path.name)
