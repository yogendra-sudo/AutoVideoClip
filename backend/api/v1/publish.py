"""
API for publishing to overseas platforms (Upload-Post).

    GET  /publish/upload-post/config                       current config (key masked)
    PUT  /publish/upload-post/config                       save key / default profile (validates key before saving)
    DELETE /publish/upload-post/config                     delete locally saved config
    GET  /publish/upload-post/profiles                      profiles under the API key and connected platforms
    POST /publish/upload-post/{project_id}/clips/{clip_id} export + submit publish (background task, returns job_id)
    GET  /publish/upload-post/jobs/{job_id}                 job status; submitted jobs include per-platform results (remote)
    GET  /publish/upload-post/requests/{request_id}         query Upload-Post directly by request_id
    GET  /publish/upload-post/{project_id}/records          publish records submitted for this project

Available in desktop / Docker / script modes (does not depend on check_desktop_mode).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from backend.services import bilibili_publisher as bili
from backend.services import cover as cover_svc
from backend.services import upload_post_publisher as up

router = APIRouter(prefix="/publish", tags=["publish"])


class UploadPostConfigBody(BaseModel):
    api_key: str | None = Field(None, description="Upload-Post API Key; leave empty to keep the existing one")
    user: str | None = Field(None, description="Default profile (the user in Upload-Post)")


class BilibiliConfigBody(BaseModel):
    cookie: str = Field(..., description="Cookie from the browser request header; must contain SESSDATA, bili_jct, DedeUserID")


class BilibiliPublishBody(BaseModel):
    output_variant_id: str | None = Field(None, pattern=r'^[a-zA-Z0-9_-]{1,100}$', description="Completed Bilibili auto-generated version; when provided, does not re-export")
    title: str | None = None
    description: str | None = None
    subtitles: bool = True
    title_card: bool = True
    scheduled_date: str | None = None
    timezone: str | None = None
    visibility: str = Field("private", description="private = only self / public = public")


class PublishBody(BaseModel):
    platforms: list[str] = Field(..., description="tiktok / instagram / youtube / facebook / linkedin / x / threads / pinterest / bluesky …")
    user: str | None = Field(None, description="Upload-Post profile; if empty uses the configured default")
    preset: str | None = Field(None, description="Publish export preset; if empty auto-selects by platform (shorts for vertical, otherwise original)")
    output_variant_id: str | None = Field(None, pattern=r'^[a-zA-Z0-9_-]{1,100}$', description="Completed automatic platform version; when provided, does not re-export")
    title: str | None = Field(None, description="Title; if empty uses the clip title")
    description: str | None = Field(None, description="Description for YouTube / LinkedIn / Facebook / Pinterest")
    subtitles: bool = True
    title_card: bool = True
    scheduled_date: str | None = Field(None, description="ISO-8601 scheduled publish time")
    timezone: str | None = Field(None, description="IANA timezone, paired with scheduled_date")
    extra: dict[str, Any] = Field(default_factory=dict, description="Platform-specific passthrough fields, e.g. privacy_level, privacyStatus, facebook_page_id, pinterest_board_id")


class CoverConfigBody(BaseModel):
    enabled: bool | None = None
    provider: str | None = Field(None, description="openai / seedream / dashscope")
    model: str | None = None
    api_key: str | None = Field(None, description="leave empty to keep the existing key")
    base_url: str | None = None
    ocr_model: str | None = None
    allow_send_frame: bool | None = Field(None, description="whether to allow sending video frames to a third-party image generation service; off by default")
    mode: str | None = Field(None, description="text_model follows the AI model provider / custom is configured separately")


class CoverGenerateBody(BaseModel):
    platform: str = Field("bilibili", description="bilibili landscape / douyin portrait")
    title: str | None = None
    subtitle: str | None = None
    badge: str | None = None
    content_type: str | None = Field(None, description="knowledge / interview / game / vlog / general")
    force_local: bool = False
    sync: bool = Field(False, description="when True generates synchronously (for testing); default is a background task")


def _bili_error(exc: Exception) -> HTTPException:
    if isinstance(exc, bili.BilibiliError):
        code = exc.status_code if exc.status_code in (400, 401, 404) else 400
        return HTTPException(status_code=code, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


def _http_error(e: Exception) -> HTTPException:
    if isinstance(e, up.UploadPostError):
        code = e.status_code if e.status_code in (401, 402, 403, 404, 409, 422, 429) else 400
        return HTTPException(status_code=code, detail=str(e))
    if isinstance(e, (ValueError, FileNotFoundError)):
        return HTTPException(status_code=400, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


@router.get("/upload-post/config")
async def get_upload_post_config():
    cfg = up.load_config()
    return {
        "configured": cfg.configured,
        "source": cfg.source,
        "api_key_masked": cfg.masked_key(),
        "user": cfg.user,
        "base_url": cfg.base_url,
        "platforms": up.PLATFORMS,
    }


@router.put("/upload-post/config")
async def put_upload_post_config(body: UploadPostConfigBody):
    if body.api_key is None and body.user is None:
        raise HTTPException(status_code=400, detail="Provide at least one of api_key or user")
    if body.api_key is not None:
        key = body.api_key.strip()
        if not key:
            raise HTTPException(status_code=400, detail="api_key cannot be empty")
        try:
            verified = up.verify_api_key(up.UploadPostConfig(api_key=key, base_url=up.load_config().base_url))
        except up.UploadPostError as e:
            raise _http_error(e)
    else:
        verified = None
    cfg = up.save_config(api_key=body.api_key, user=body.user)
    if cfg.source == "env":
        # Environment variables take precedence over the file: the file is written but will not take effect; tell the caller directly
        note = "Saved to file, but the current process uses the UPLOAD_POST_API_KEY environment variable"
    else:
        note = None
    return {"ok": True, "configured": cfg.configured, "source": cfg.source, "api_key_masked": cfg.masked_key(),
            "user": cfg.user, "account": verified, "note": note}


@router.delete("/upload-post/config")
async def delete_upload_post_config():
    up.clear_config()
    return {"ok": True, "configured": up.load_config().configured}


@router.get("/upload-post/profiles")
async def get_upload_post_profiles():
    try:
        return {"profiles": up.list_profiles()}
    except Exception as e:  # noqa: BLE001
        raise _http_error(e)


@router.post("/upload-post/{project_id}/clips/{clip_id}")
async def start_upload_post_publish(project_id: str, clip_id: str, body: PublishBody):
    from backend.services.publish_export import PRESETS, load_clip_meta
    try:
        load_clip_meta(project_id, clip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    try:
        platforms = up.normalize_platforms(body.platforms)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if body.preset and body.preset not in PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {body.preset} (available {', '.join(PRESETS)})")
    cfg = up.load_config()
    if not cfg.configured:
        raise HTTPException(status_code=400, detail="No Upload-Post API key configured (PUT /publish/upload-post/config or the UPLOAD_POST_API_KEY environment variable)")
    if not (body.user or cfg.user):
        raise HTTPException(status_code=400, detail="No Upload-Post profile (user) specified")
    return up.start_publish(up.PublishRequest(
        project_id=project_id, clip_id=clip_id, platforms=platforms, user=body.user, preset=body.preset, output_variant_id=body.output_variant_id,
        title=body.title, description=body.description, subtitles=body.subtitles, title_card=body.title_card,
        scheduled_date=body.scheduled_date, timezone=body.timezone, extra=body.extra,
    ))


@router.get("/upload-post/jobs/{job_id}")
async def get_upload_post_job(job_id: str):
    job = up.get_publish_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such publish task")
    return job


@router.get("/upload-post/requests/{request_id}")
async def get_upload_post_request(request_id: str, project_id: str | None = None):
    try:
        return up.get_status(request_id, project_id=project_id)
    except Exception as e:  # noqa: BLE001
        raise _http_error(e)


@router.get("/upload-post/{project_id}/records")
async def list_upload_post_records(project_id: str):
    return {"records": up.list_records(project_id)}


@router.delete("/upload-post/{project_id}/records/{request_id}")
async def cancel_upload_post_record(project_id: str, request_id: str):
    try:
        return up.cancel_record(project_id, request_id)
    except bili.BilibiliError as e:
        raise _bili_error(e)
    except Exception as e:  # noqa: BLE001
        raise _http_error(e)


@router.get("/bilibili/config")
async def get_bilibili_config():
    return bili.load_config().public()


@router.put("/bilibili/config")
async def put_bilibili_config(body: BilibiliConfigBody):
    cookie = body.cookie.strip()
    if not cookie:
        raise HTTPException(status_code=400, detail="Cookie cannot be empty")
    try:
        account = bili.verify_cookie(cookie)
    except bili.BilibiliError as e:
        raise _bili_error(e)
    cfg = bili.save_config(account["cookie"], account["nickname"], account["uid"])
    payload = {"ok": True, **cfg.public()}
    if cfg.source == "env":
        payload["note"] = "Saved to file, but the current process uses the BILIBILI_COOKIE environment variable"
    return payload


@router.delete("/bilibili/config")
async def delete_bilibili_config():
    bili.clear_config()
    return {"ok": True, **bili.load_config().public()}


@router.post("/bilibili/{project_id}/clips/{clip_id}")
async def start_bilibili_publish(project_id: str, clip_id: str, body: BilibiliPublishBody):
    from backend.services.publish_export import load_clip_meta
    try:
        load_clip_meta(project_id, clip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if body.visibility not in ("private", "public"):
        raise HTTPException(status_code=400, detail="Visibility can only be private or public")
    if not bili.load_config().configured:
        raise HTTPException(status_code=400, detail="No Bilibili account configured")
    return bili.start_publish(bili.BilibiliPublishRequest(
        project_id=project_id,
        clip_id=clip_id,
        output_variant_id=body.output_variant_id,
        title=body.title,
        description=body.description,
        subtitles=body.subtitles,
        title_card=body.title_card,
        scheduled_date=body.scheduled_date,
        timezone=body.timezone,
        visibility=body.visibility,
    ))


@router.get("/bilibili/jobs/{job_id}")
async def get_bilibili_job(job_id: str):
    job = bili.get_publish_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such publish task")
    return job


def _cover_error(exc: Exception) -> HTTPException:
    if isinstance(exc, cover_svc.CoverError):
        code = exc.status_code if exc.status_code in (400, 401, 404) else 400
        return HTTPException(status_code=code, detail=str(exc))
    if isinstance(exc, FileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/covers/config")
async def get_cover_config():
    return cover_svc.load_config().public()


@router.put("/covers/config")
async def put_cover_config(body: CoverConfigBody):
    if body.mode is not None and body.mode not in ("text_model", "custom"):
        raise HTTPException(status_code=400, detail="mode can only be text_model or custom")
    if body.mode != "text_model" and body.provider is not None and body.provider.strip().lower() not in ("openai", "seedream", "dashscope"):
        raise HTTPException(status_code=400, detail="Image generation provider can only be openai, seedream, or dashscope")
    cfg = cover_svc.save_config(
        enabled=body.enabled,
        provider=body.provider,
        model=body.model,
        api_key=body.api_key,
        base_url=body.base_url,
        ocr_model=body.ocr_model,
        allow_send_frame=body.allow_send_frame,
        mode=body.mode,
    )
    payload = {"ok": True, **cfg.public()}
    if cfg.source == "env":
        payload["note"] = "Key comes from the IMAGE_API_KEY environment variable; changes here will not override it."
    return payload


@router.delete("/covers/config")
async def delete_cover_config():
    return {"ok": True, **cover_svc.clear_config().public()}


@router.get("/covers/{project_id}/clips/{clip_id}")
async def get_clip_cover(project_id: str, clip_id: str, platform: str = "bilibili"):
    from backend.services.publish_export import load_clip_meta
    try:
        load_clip_meta(project_id, clip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    found = cover_svc.get_cover(project_id, clip_id, platform)
    if not found:
        return {"ok": False, "platform": cover_svc.normalize_platform(platform), "url": None}
    return found


@router.get("/covers/{project_id}/clips/{clip_id}/file")
async def get_clip_cover_file(project_id: str, clip_id: str, platform: str = "bilibili"):
    platform = cover_svc.normalize_platform(platform)
    path = cover_svc.cover_path(project_id, clip_id, platform)
    if not path.exists() or path.stat().st_size <= 0:
        raise HTTPException(status_code=404, detail="This cover does not exist yet")
    return FileResponse(path, media_type="image/jpeg", filename=f"{clip_id}_{platform}.jpg")


@router.post("/covers/{project_id}/clips/{clip_id}")
async def start_cover_generate(project_id: str, clip_id: str, body: CoverGenerateBody):
    from backend.services.publish_export import load_clip_meta
    try:
        load_clip_meta(project_id, clip_id)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    platform = cover_svc.normalize_platform(body.platform)
    if body.sync:
        try:
            return cover_svc.generate_cover(
                project_id=project_id,
                clip_id=clip_id,
                platform=platform,
                title=body.title,
                subtitle=body.subtitle,
                badge=body.badge,
                content_type=body.content_type,
                force_local=body.force_local,
            )
        except Exception as e:  # noqa: BLE001
            raise _cover_error(e)
    return cover_svc.start_generate(
        project_id=project_id,
        clip_id=clip_id,
        platform=platform,
        title=body.title,
        subtitle=body.subtitle,
        badge=body.badge,
        content_type=body.content_type,
        force_local=body.force_local,
    )


@router.get("/covers/jobs/{job_id}")
async def get_cover_job(job_id: str):
    job = cover_svc.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="No such cover task")
    return job


@router.post("/covers/jobs/{job_id}/cancel")
async def cancel_cover_job(job_id: str):
    return cover_svc.cancel_job(job_id)
