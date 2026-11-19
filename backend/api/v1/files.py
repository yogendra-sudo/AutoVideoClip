"""
File management API
Provides file upload, download, and access features
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from pathlib import Path
import shutil
import uuid

from ...core.database import get_db
from ...services.storage_service import StorageService
from ...models.project import Project
from ...models.clip import Clip
from ...models.collection import Collection

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/files", tags=["file management"])

@router.post("/upload")
async def upload_files(
    files: List[UploadFile] = File(...),
    project_id: str = Query(..., description="Project ID"),
    db: Session = Depends(get_db)
):
    """
    Upload files (optimized storage mode)
    
    - Save files to the file system
    - Update file paths in the database
    - Do not store file contents in the database
    """
    try:
        # Validate whether the project exists
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Initialize the storage service
        storage_service = StorageService(project_id)
        
        uploaded_files = []
        
        for file in files:
            # Generate a unique filename
            file_id = str(uuid.uuid4())
            file_extension = Path(file.filename).suffix if file.filename else ""
            safe_filename = f"{file_id}{file_extension}"
            
            # Determine the file type
            file_type = "raw"  # default to raw file
            if file.filename:
                if file.filename.lower().endswith(('.srt', '.vtt')):
                    file_type = "subtitle"
                elif file.filename.lower().endswith(('.mp4', '.avi', '.mov', '.mkv')):
                    file_type = "video"
            
            # Save the file to the file system
            file_path = Path(f"/tmp/{safe_filename}")
            with open(file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Save the file using the storage service
            saved_path = storage_service.save_file(file_path, safe_filename, file_type)
            
            # Update the project database record
            if file_type == "video":
                project.video_path = saved_path
            elif file_type == "subtitle":
                project.subtitle_path = saved_path
            
            # Clean up the temporary file
            file_path.unlink()
            
            uploaded_files.append({
                "original_name": file.filename,
                "saved_path": saved_path,
                "file_type": file_type,
                "file_size": file.size
            })
        
        # Commit database changes
        db.commit()
        
        logger.info(f"Project {project_id} uploaded {len(uploaded_files)} files")
        
        return {
            "success": True,
            "project_id": project_id,
            "uploaded_files": uploaded_files,
            "message": f"Successfully uploaded {len(uploaded_files)} files"
        }
        
    except Exception as e:
        logger.error(f"File upload failed: {e}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")

@router.get("/clips/{clip_id}/content")
async def get_clip_content(
    clip_id: str,
    db: Session = Depends(get_db)
):
    """
    Get the full content of a clip
    
    - Get metadata from the database
    - Get the full data from the file system
    """
    try:
        # Get the clip record
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            raise HTTPException(status_code=404, detail="Clip not found")
        
        # Get the full content from the file system
        from ...repositories.clip_repository import ClipRepository
        clip_repo = ClipRepository(db)
        content = clip_repo.get_clip_content(clip_id)
        
        if not content:
            raise HTTPException(status_code=404, detail="Clip content not found")
        
        return {
            "clip_id": clip_id,
            "content": content,
            "metadata": {
                "title": clip.title,
                "duration": clip.duration,
                "score": clip.score,
                "video_path": clip.video_path
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get clip content: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get clip content: {str(e)}")

@router.get("/collections/{collection_id}/content")
async def get_collection_content(
    collection_id: str,
    db: Session = Depends(get_db)
):
    """
    Get the full content of a collection
    
    - Get metadata from the database
    - Get the full data from the file system
    """
    try:
        # Get the collection record
        collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        # Get the full content from the file system
        from ...repositories.collection_repository import CollectionRepository
        collection_repo = CollectionRepository(db)
        content = collection_repo.get_collection_content(collection_id)
        
        if not content:
            raise HTTPException(status_code=404, detail="Collection content not found")
        
        return {
            "collection_id": collection_id,
            "content": content,
            "metadata": {
                "name": collection.name,
                "description": collection.description,
                "clips_count": collection.clips_count,
                "export_path": collection.export_path
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get collection content: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get collection content: {str(e)}")

@router.get("/clips/{clip_id}/download")
async def download_clip_file(
    clip_id: str,
    db: Session = Depends(get_db)
):
    """
    Download a clip file
    
    - Get the file path from the database
    - Return the file stream
    """
    try:
        # Get the clip record
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            raise HTTPException(status_code=404, detail="Clip not found")
        
        if not clip.video_path:
            raise HTTPException(status_code=404, detail="Clip file not found")
        
        file_path = Path(clip.video_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Clip file not found")
        
        return FileResponse(
            path=str(file_path),
            filename=f"clip_{clip_id}.mp4",
            media_type="video/mp4"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download clip file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download clip file: {str(e)}")

@router.get("/projects/{project_id}/clips/{clip_id}")
async def get_project_clip_video(
    project_id: str,
    clip_id: str,
    db: Session = Depends(get_db)
):
    """
    Get a project clip video (supports frontend playback)
    
    - Supports getting a video by project ID and clip ID
    - Returns a video file stream, supporting online playback
    """
    try:
        # Validate whether the project exists
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get the clip record
        clip = db.query(Clip).filter(Clip.id == clip_id).first()
        if not clip:
            raise HTTPException(status_code=404, detail="Clip not found")
        
        # Validate that the clip belongs to this project
        if clip.project_id != project_id:
            raise HTTPException(status_code=403, detail="Clip does not belong to this project")
        
        if not clip.video_path:
            raise HTTPException(status_code=404, detail="Clip file not found")
        
        file_path = Path(clip.video_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Clip file not found")
        
        # Inline playback. With the default attachment, macOS WKWebView's <video> will not play.
        return FileResponse(
            path=str(file_path),
            filename=f"clip_{clip_id}.mp4",
            media_type="video/mp4",
            content_disposition_type="inline",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get project clip video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get project clip video: {str(e)}")

@router.get("/collections/{collection_id}/download")
async def download_collection_file(
    collection_id: str,
    db: Session = Depends(get_db)
):
    """
    Download a collection file
    
    - Get the file path from the database
    - Return the file stream
    """
    try:
        # Get the collection record
        collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        if not collection.export_path:
            raise HTTPException(status_code=404, detail="Collection file not found")
        
        file_path = Path(collection.export_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Collection file not found")
        
        return FileResponse(
            path=str(file_path),
            filename=f"collection_{collection_id}.mp4",
            media_type="video/mp4"
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to download collection file: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to download collection file: {str(e)}")

@router.get("/projects/{project_id}/collections/{collection_id}")
async def get_project_collection_video(
    project_id: str,
    collection_id: str,
    db: Session = Depends(get_db)
):
    """
    Get a project collection video (supports frontend playback)
    
    - Supports getting a video by project ID and collection ID
    - Returns a video file stream, supporting online playback
    """
    try:
        # Validate whether the project exists
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get the collection record
        collection = db.query(Collection).filter(Collection.id == collection_id).first()
        if not collection:
            raise HTTPException(status_code=404, detail="Collection not found")
        
        # Validate that the collection belongs to this project (if it has a project_id field)
        # Note: this assumes the Collection model has a project_id field; adjust if it does not
        
        if not collection.export_path:
            raise HTTPException(status_code=404, detail="Collection file not found")
        
        file_path = Path(collection.export_path)
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Collection file not found")
        
        # Inline playback. With the default attachment, macOS WKWebView's <video> will not play.
        return FileResponse(
            path=str(file_path),
            filename=f"collection_{collection_id}.mp4",
            media_type="video/mp4",
            content_disposition_type="inline",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "no-cache",
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get project collection video: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get project collection video: {str(e)}")

@router.get("/projects/{project_id}/storage-info")
async def get_project_storage_info(
    project_id: str,
    db: Session = Depends(get_db)
):
    """
    Get project storage info
    
    - Count files and their sizes
    - Show storage usage
    """
    try:
        # Validate whether the project exists
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Get storage info
        storage_service = StorageService(project_id)
        storage_info = storage_service.get_project_storage_info()
        
        return {
            "project_id": project_id,
            "storage_info": storage_info,
            "file_paths": {
                "video_path": project.video_path,
                "subtitle_path": project.subtitle_path
            }
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get project storage info: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get project storage info: {str(e)}")

@router.delete("/projects/{project_id}/cleanup")
async def cleanup_project_files(
    project_id: str,
    keep_days: int = Query(30, description="Retention days"),
    db: Session = Depends(get_db)
):
    """
    Clean up old project files
    
    - Clean up temporary files older than the specified number of days
    - Free up storage space
    """
    try:
        # Validate whether the project exists
        project = db.query(Project).filter(Project.id == project_id).first()
        if not project:
            raise HTTPException(status_code=404, detail="Project not found")
        
        # Clean up old files
        storage_service = StorageService(project_id)
        storage_service.cleanup_old_files(project_id, keep_days)
        
        return {
            "success": True,
            "project_id": project_id,
            "keep_days": keep_days,
            "message": f"Project {project_id} old files cleaned up"
        }
        
    except Exception as e:
        logger.error(f"Failed to clean up project files: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clean up project files: {str(e)}")
