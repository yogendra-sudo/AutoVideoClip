"""
Health check API routes
"""

from fastapi import APIRouter
from datetime import datetime
from typing import Dict, Any

from backend import __version__

router = APIRouter()


@router.get("/")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint."""
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "version": __version__
    }


@router.get("/video-categories")
async def get_video_categories() -> Dict[str, Any]:
    """Get video category configuration."""
    return {
        "categories": [
            {
                "value": "knowledge",
                "name": "Knowledge & science",
                "description": "Science, technology, history, culture and other knowledge content",
                "icon": "book",
                "color": "#1890ff"
            },
            {
                "value": "entertainment", 
                "name": "Entertainment",
                "description": "Games, music, films, variety shows and other entertainment content",
                "icon": "play-circle",
                "color": "#52c41a"
            },
            {
                "value": "experience",
                "name": "Life experience",
                "description": "Life tips, food, travel, crafts and other practical content",
                "icon": "heart",
                "color": "#fa8c16"
            },
            {
                "value": "opinion",
                "name": "Opinion & commentary",
                "description": "Current affairs commentary, opinion sharing, social topics, etc.",
                "icon": "message",
                "color": "#722ed1"
            },
            {
                "value": "business",
                "name": "Business & finance",
                "description": "Business analysis, financial news, investing, etc.",
                "icon": "dollar",
                "color": "#13c2c2"
            },
            {
                "value": "speech",
                "name": "Speech & interview",
                "description": "Speeches, interviews, conversations and other spoken content",
                "icon": "sound",
                "color": "#eb2f96"
            }
        ],
        "default_category": "knowledge"
    } 
