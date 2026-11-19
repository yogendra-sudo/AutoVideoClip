"""
Settings management API endpoints
Provides settings management for the Desktop client
"""

import os
import json
import shutil
import logging
from pathlib import Path
from typing import Dict, Any, Optional, List, Literal
from fastapi import APIRouter, HTTPException, UploadFile, File, Depends, Body
from pydantic import BaseModel, ConfigDict, Field, validator

logger = logging.getLogger(__name__)

from backend import __version__
from backend.core.llm_telemetry import sanitize_exception_text
from backend.core.desktop_config import get_desktop_config, is_desktop_mode, DesktopConfig, save_desktop_config
from backend.services.config_sync_service import config_sync_service
from pathlib import Path

router = APIRouter(prefix="/settings", tags=["settings"])

from backend.services import ai_model_settings as ai_models
from backend.services import output_branding, output_captions


@router.get('/output-branding')
def get_output_branding():
    return output_branding.load_settings()


@router.put('/output-branding')
def set_output_branding(body: output_branding.BrandingSettings):
    return output_branding.save_settings(body)


@router.get('/output-captions')
def get_output_captions():
    return output_captions.load_settings()


@router.put('/output-captions')
def set_output_captions(body: output_captions.CaptionSettings):
    return output_captions.save_settings(body)


@router.get('/ai-models')
def get_ai_models():
    return ai_models.public(ai_models.for_editing())


@router.put('/ai-models')
def put_ai_models(body: ai_models.ModelSettings):
    try:
        return ai_models.save(body)
    except ValueError as exc:
        from backend.core.log_redaction import redact_text
        raise HTTPException(status_code=422, detail=redact_text(str(exc))) from exc


class ConnectionModelsRequest(BaseModel):
    connection: ai_models.Connection
    refresh: bool = False


@router.post('/ai-models/discover')
async def discover_connection_models(body: ConnectionModelsRequest):
    from backend.core.model_registry import discover
    try:
        connection = ai_models.resolve_secret(body.connection, ai_models.for_editing())
        return await discover(connection, body.refresh)
    except ValueError as exc:
        from backend.core.log_redaction import redact_text
        raise HTTPException(status_code=422, detail=redact_text(str(exc))) from exc


class ConnectionTestRequest(BaseModel):
    connection: ai_models.Connection
    model: str = Field(min_length=1, max_length=200)
    vision: bool = False
    purpose: Literal['analysis', 'vision', 'cover', 'transcription'] = 'analysis'
    probe_kind: Literal['quick', 'trial'] = 'quick'
    language: Literal['zh', 'en'] = 'zh'



class OllamaPullRequest(BaseModel):
    """One-click pull for the T3 recommended local models."""
    model: str = Field(min_length=1, max_length=200)
    base_url: str = Field(default='http://127.0.0.1:11434/v1', max_length=500)


@router.post('/ollama/pull')
def ollama_pull_model(body: OllamaPullRequest):
    """Proxy Ollama ``POST /api/pull`` as SSE progress events.

    Never returns keys. Body lines are ``data: {json}\\n\\n`` with
    ``status`` / ``completed`` / ``total`` / ``done`` / ``error`` only.
    """
    import json as _json
    from urllib.parse import urlparse
    import httpx
    from fastapi.responses import StreamingResponse
    from backend.core.llm_providers import is_local_url

    model = body.model.strip()
    if not model or any(ch in model for ch in ('\n', '\r', ' ')):
        raise HTTPException(status_code=422, detail='Invalid model name')
    raw_base = (body.base_url or '').strip() or 'http://127.0.0.1:11434/v1'
    try:
        parsed = urlparse(raw_base if '://' in raw_base else 'http://' + raw_base)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=422, detail='Invalid base_url') from exc
    if not is_local_url(raw_base):
        raise HTTPException(status_code=400, detail='Ollama pull only allowed for local addresses')
    host = parsed.hostname or '127.0.0.1'
    port = parsed.port or (443 if parsed.scheme == 'https' else 80)
    # Ollama native API lives on the root, not /v1.
    root = f"{parsed.scheme or 'http'}://{host}:{port}"
    if raw_base.rstrip('/').endswith('/v1'):
        root = raw_base.rstrip('/')[:-3].rstrip('/') or root

    def events():
        url = root.rstrip('/') + '/api/pull'
        try:
            with httpx.stream('POST', url, json={'name': model, 'stream': True},
                              timeout=None, trust_env=False) as response:
                if response.status_code >= 400:
                    yield f"data: {_json.dumps({'error': 'pull_failed', 'status': response.status_code}, ensure_ascii=False)}\n\n"
                    return
                for line in response.iter_lines():
                    if not line:
                        continue
                    try:
                        payload = _json.loads(line)
                    except ValueError:
                        continue
                    if not isinstance(payload, dict):
                        continue
                    out = {}
                    if isinstance(payload.get('status'), str):
                        out['status'] = payload['status'][:120]
                    if isinstance(payload.get('completed'), int):
                        out['completed'] = payload['completed']
                    if isinstance(payload.get('total'), int):
                        out['total'] = payload['total']
                    if payload.get('done') is True or payload.get('status') == 'success':
                        out['done'] = True
                    if isinstance(payload.get('error'), str):
                        out['error'] = payload['error'][:200]
                    yield f"data: {_json.dumps(out, ensure_ascii=False)}\n\n"
                    if out.get('done') or out.get('error'):
                        return
        except httpx.HTTPError as exc:
            yield f"data: {_json.dumps({'error': 'unreachable', 'status': str(exc)[:120]}, ensure_ascii=False)}\n\n"

    return StreamingResponse(events(), media_type='text/event-stream',
                             headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})



@router.post('/ai-models/fetch-list')
def fetch_connection_model_list(body: Any = Body(default=None)):
    """Custom-provider and settings 'fetch list': GET /models, intersect, backfill.

    Never returns keys, full URLs, or upstream response text.
    """
    from backend.services.provider_validation import fetch_list_for_connection
    try:
        request = ConnectionModelsRequest.model_validate(body)
        connection = ai_models.resolve_secret(request.connection, ai_models.for_editing())
        return fetch_list_for_connection(connection).as_api()
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Invalid provider connection") from exc
    except Exception:
        from backend.core.provider_model_fetch import FETCH_LIST_FAILED
        from backend.core.upstream_errors import hint_key_for
        return {
            'ok': False, 'success': False, 'models': [], 'recommended': {},
            'truncated': False, 'source': 'empty', 'error_type': 'unknown',
            'hint_key': hint_key_for('unknown'), 'message_key': FETCH_LIST_FAILED,
            'base_url_host': 'unknown',
        }


@router.post('/ai-models/test')
def test_connection_assignment(body: ConnectionTestRequest):
    from backend.services.provider_validation import validate_connection, validate_connection_with_probe
    source = None
    try:
        connection = ai_models.resolve_secret(body.connection, ai_models.for_editing())
        from backend.services.studio.failure_identity import config_source as _config_source
        source = _config_source(connection.provider, connection.base_url, body.model)
        if body.purpose in ('cover', 'transcription'):
            result = validate_connection(connection, body.model, purpose=body.purpose)
            if body.purpose == 'cover' and connection.image_base_url:
                # The normalised image endpoint must not replace the chat address.
                result.normalized_base_url = connection.base_url
        else:
            # F2: trial probe is analysis-only; vision path stays on quick then vision probe below.
            probe = body.probe_kind if body.purpose == 'analysis' else 'quick'
            result = validate_connection_with_probe(
                connection, body.model,
                purpose='analysis',
                probe_kind=probe,
                language=body.language,
            )
        if (body.vision or body.purpose == 'vision') and body.purpose in ('analysis', 'vision') and result.ok:
            from backend.services.studio.vision_settings import test, VisionSettingsInput
            from backend.core.connection_test_codes import vision_error_code
            endpoint = ai_models.chat_endpoint(connection, body.model)
            from backend.services.studio.failure_identity import connection_identity
            from backend.services.studio.vision_settings import testing_identity
            # the tested connection's own identity, never inferred from its hostname.
            with testing_identity(connection_identity(connection, body.model)):
                vision = test(VisionSettingsInput(mode='custom', **endpoint))
            if not (vision.get('success') or vision.get('ok')):
                from backend.core.upstream_errors import hint_key_for
                payload = result.as_api()
                payload.update(
                    success=False, ok=False, result='failed',
                    error_type='unknown', hint_key=hint_key_for('unknown'),
                    error_code=vision_error_code(vision), http_status=None, config_source=source,
                )
                return payload
        return {**result.as_api(), 'config_source': source}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        from backend.core.upstream_errors import classify_exception
        from backend.core.connection_test_codes import connection_test_error_code
        from backend.core.upstream_errors import network_kind_of, http_error_parts
        from backend.core.connection_test_codes import safe_http_status
        classified = classify_exception(exc)
        status = http_error_parts(exc)[0]  # e.g. the visual probe's 401/429/503 (VisionRequestError.http_status)
        return {
            'success': False, 'ok': False, 'result': 'transient' if classified.retryable else 'failed',
            'error_type': classified.error_type.value, 'hint_key': classified.hint_key, 'models': [],
            'error_code': connection_test_error_code(classified.error_type.value, http_status=status, network_kind=network_kind_of(exc)),
            'http_status': safe_http_status(status), **({'config_source': source} if source else {}),
        }


class BasicSettings(BaseModel):
    """Basic settings"""
    app_name: str = Field(default="AutoClip Desktop", description="Application name")
    app_version: str = Field(default=__version__, description="Application version")
    debug_mode: bool = Field(default=False, description="Debug mode")
    auto_start: bool = Field(default=True, description="Auto start")


class ServiceSettings(BaseModel):
    """Service settings"""
    host: str = Field(default="127.0.0.1", description="Service host")
    port: int = Field(default=8000, description="Service port")
    max_memory_usage: int = Field(default=2048, description="Maximum memory usage (MB)")
    
    @validator('port')
    def validate_port(cls, v):
        if not 1024 <= v <= 65535:
            raise ValueError('Port must be between 1024 and 65535')
        return v
    
    @validator('max_memory_usage')
    def validate_memory(cls, v):
        if not 512 <= v <= 8192:
            raise ValueError('Memory limit must be between 512 and 8192 MB')
        return v


class ApiKeys(BaseModel):
    """API key settings"""
    model_config = ConfigDict(hide_input_in_errors=True)
    dashscope: str = Field(default="", description="Qwen API key")
    openai: str = Field(default="", description="OpenAI API key")
    gemini: str = Field(default="", description="Gemini API key")
    siliconflow: str = Field(default="", description="SiliconFlow API key (no longer a standalone provider; kept only for legacy config compatibility)")
    deepseek: str = Field(default="", description="DeepSeek official API key")
    kimi: str = Field(default="", description="Kimi / Moonshot API key")
    glm: str = Field(default="", description="Zhipu GLM API key")
    grok: str = Field(default="", description="xAI Grok API key")
    infistar: str = Field(default="", description="Infistar API key")
    api88: str = Field(default="", description="88API API key")
    apimart: str = Field(default="", description="APIMart API key")
    seed: str = Field(default="", description="Volcano Ark Seed / Doubao API key")
    jimeng_access: str = Field(default="", description="Jimeng AI access key")
    jimeng_secret: str = Field(default="", description="Jimeng AI secret key")


class ApiSettings(BaseModel):
    """API settings"""
    api_keys: ApiKeys = Field(default_factory=ApiKeys, description="API keys")
    api_provider: str = Field(default="dashscope", description="Current LLM provider (dashscope / openai / gemini / deepseek / seed / kimi / glm / grok / infistar / api88 / apimart, or local presets ollama / lmstudio)")
    api_base_url: str = Field(default="", description="OpenAI-compatible API address; empty when provider=openai means the official address, empty for local presets uses the preset default address")
    api_model: str = Field(default="qwen-plus", description="Default model")
    api_max_tokens: int = Field(default=4096, description="Maximum tokens")
    api_timeout: int = Field(default=30, description="API timeout (seconds)")
    
    @validator('api_timeout')
    def validate_timeout(cls, v):
        if not 5 <= v <= 300:
            raise ValueError('API timeout must be between 5 and 300 seconds')
        return v


class ProcessingSettings(BaseModel):
    """Processing settings"""
    processing_chunk_size: int = Field(default=5000, description="Processing chunk size")
    processing_min_score: float = Field(default=0.7, description="Minimum score threshold")
    processing_max_clips: int = Field(default=5, description="Maximum clips per collection")
    processing_max_retries: int = Field(default=3, description="Maximum retry count")
    
    @validator('processing_chunk_size')
    def validate_chunk_size(cls, v):
        if not 1000 <= v <= 10000:
            raise ValueError('Processing chunk size must be between 1000 and 10000')
        return v
    
    @validator('processing_min_score')
    def validate_min_score(cls, v):
        if not 0.1 <= v <= 1.0:
            raise ValueError('Minimum score threshold must be between 0.1 and 1.0')
        return v


class LogSettings(BaseModel):
    """Log settings"""
    log_level: str = Field(default="INFO", description="Log level")
    log_retention_days: int = Field(default=7, description="Log retention days")
    
    @validator('log_level')
    def validate_log_level(cls, v):
        if v not in ['DEBUG', 'INFO', 'WARNING', 'ERROR']:
            raise ValueError('Log level must be DEBUG, INFO, WARNING, or ERROR')
        return v
    
    @validator('log_retention_days')
    def validate_retention_days(cls, v):
        if not 1 <= v <= 30:
            raise ValueError('Log retention days must be between 1 and 30')
        return v


class PathSettings(BaseModel):
    """Path settings"""
    data_directory: str = Field(description="Data directory")
    cache_directory: str = Field(description="Cache directory")
    temp_directory: str = Field(description="Temporary directory")


class UpdateDataDirRequest(BaseModel):
    """Update data directory request"""
    new_data_directory: str = Field(description="New data directory path")
    migrate: bool = Field(default=True, description="Whether to migrate old directory data")


class DesktopSettings(BaseModel):
    """Complete Desktop settings"""
    basic: BasicSettings = Field(default_factory=BasicSettings)
    service: ServiceSettings = Field(default_factory=ServiceSettings)
    api: ApiSettings = Field(default_factory=ApiSettings)
    processing: ProcessingSettings = Field(default_factory=ProcessingSettings)
    logs: LogSettings = Field(default_factory=LogSettings)
    paths: Optional[PathSettings] = Field(default=None, description="Path settings")


def check_desktop_mode(relaxed: bool = False):
    """Check whether in Desktop mode
    When relaxed=True the restriction is loosened to allow pilot packages/development environments (returns a warning but does not block).

    Only endpoints that truly depend on the desktop shell / local filesystem need it (data directory migration, backup restore, import/export, client config sync).
    Config endpoints that read/write settings.json, test connections, or query the current provider also work in Docker / script mode:
    settings.json lives in `get_data_directory()`, and both the API process and the Celery worker hot-reload by mtime.
    Previously these endpoints were also blocked with 400, forcing Docker users to edit .env only (issue #100).
    """
    if not is_desktop_mode():
        if relaxed:
            return False
        raise HTTPException(status_code=400, detail="This endpoint is only available in Desktop mode")


class PrivacySettings(BaseModel):
    crash_reports: bool = True


@router.get("/privacy")
async def get_privacy():
    """Crash report and statistics switch (desktop data directory privacy.json).

    ``analytics`` is the backend opt-out. The UI must not rewrite it from an
    implicit local default. ``distinct_id`` is the anonymous id already stored,
    so a launch-frozen SDK id cannot clobber a newer one.
    """
    from backend.core.sentry_setup import crash_reports_enabled
    from backend.services.studio.qa.telemetry import _analytics_allowed, stored_distinct_id
    return {
        "crash_reports": crash_reports_enabled(),
        "analytics": _analytics_allowed(),
        "distinct_id": stored_distinct_id(),
    }


class AnalyticsIdentity(BaseModel):
    distinct_id: str = Field(min_length=8, max_length=200)


@router.put("/analytics-identity")
async def put_analytics_identity(body: AnalyticsIdentity):
    """Remember the UI's anonymous PostHog id. Backend QA events reuse it."""
    from backend.services.studio.qa.telemetry import remember_distinct_id
    if not remember_distinct_id(body.distinct_id):
        raise HTTPException(status_code=422, detail="invalid distinct_id")
    return {"ok": True}


class AnalyticsConsent(BaseModel):
    enabled: bool


@router.put("/analytics-consent")
async def put_analytics_consent(body: AnalyticsConsent):
    """The UI analytics switch. Off: backend Sentry stops attaching user.id in every process
    (before_send rereads privacy.json); this process's scope user is cleared now."""
    from backend.core.sentry_setup import clear_anonymous_user, sync_anonymous_user, write_privacy
    from backend.services.studio.qa.telemetry import set_runtime_analytics_off
    if not body.enabled:
        # stop collection in this process (API + worker threads) and drop the Sentry
        # identity BEFORE touching disk; a failed write leaves it off.
        # (known limit): the runtime flag is in-process only. Standalone worker
        # processes (e.g. a separate Celery/CLI worker) learn the preference solely by
        # re-reading privacy.json, so if the disk write below fails they cannot be reached
        # and keep the last persisted value until the write succeeds (the UI keeps retrying OFF).
        set_runtime_analytics_off(True)
        clear_anonymous_user()
    try:
        write_privacy(analytics=body.enabled)
    except (RuntimeError, OSError) as exc:
        raise HTTPException(status_code=500 if isinstance(exc, OSError) else 400,
                            detail="Failed to save privacy settings" if isinstance(exc, OSError) else str(exc)) from exc
    if body.enabled:
        set_runtime_analytics_off(False)
    sync_anonymous_user()
    return {"enabled": body.enabled}


@router.put("/privacy")
async def put_privacy(body: PrivacySettings):
    from backend.core.sentry_setup import write_privacy, crash_reports_enabled, init_sentry
    try:
        write_privacy(crash_reports=body.crash_reports)
        if body.crash_reports:
            init_sentry(os.getenv("AUTOVIDEOCLIP_MODE", "web"))
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PrivacySettings(crash_reports=crash_reports_enabled())


@router.get("/desktop-mode")
async def check_desktop_mode_endpoint():
    """Check whether running in desktop mode - for the frontend"""
    return {
        "is_desktop_mode": is_desktop_mode(),
        "environment": {
            "AUTOVIDEOCLIP_DESKTOP_MODE": os.getenv("AUTOVIDEOCLIP_DESKTOP_MODE"),
            "AUTOVIDEOCLIP_MODE": os.getenv("AUTOVIDEOCLIP_MODE"),
            "TAURI_PLATFORM": os.getenv("TAURI_PLATFORM"),
        }
    }


def _effective_llm_settings() -> Dict[str, Any]:
    """The LLM manager's effective provider / model / base_url (settings.json takes priority, then environment variables).
    Returns an empty dict when unavailable; callers fall back to defaults."""
    try:
        from backend.core.llm_manager import get_llm_manager
        return get_llm_manager().get_current_provider_info()
    except Exception as e:  # noqa: BLE001
        logger.debug("Failed to read LLM manager state, the settings page uses defaults: %s", sanitize_exception_text(type(e).__name__))
        return {}


@router.get("/", response_model=DesktopSettings)
async def get_settings():
    """Get all settings"""
    try:
        config = get_desktop_config()
        
        # Try to read from the saved settings file
        settings_file = config.paths.data_dir / "settings.json"
        logger.debug("Settings file exists: %s", settings_file.exists())
        
        if settings_file.exists():
            try:
                with open(settings_file, 'r', encoding='utf-8') as f:
                    saved_settings = json.load(f)
                
                # Validate and return the saved settings
                settings = DesktopSettings(**saved_settings)
                return settings
            except Exception as e:
                # If reading fails, fall back to default config
                logger.warning("Failed to read settings file, falling back to default config: %s", sanitize_exception_text(type(e).__name__))

        # If settings.json has never been saved: provider, model, base_url come from environment variables
        # in Docker / script mode (LLM_PROVIDER / API_MODEL_NAME / OPENAI_BASE_URL); the settings page first
        # screen should reflect this truthfully rather than always showing Qwen.
        effective = _effective_llm_settings()
        
        # Build path settings
        paths = PathSettings(
            data_directory=str(config.paths.data_dir),
            cache_directory=str(config.paths.cache_dir),
            temp_directory=str(config.paths.temp_dir)
        )
        
        # Build complete settings
        settings = DesktopSettings(
            basic=BasicSettings(
                app_name=config.app_name,
                app_version=config.app_version,
                debug_mode=config.debug_mode,
                auto_start=True  # default value
            ),
            service=ServiceSettings(
                host=config.host,
                port=config.port,
                max_memory_usage=config.max_memory_usage
            ),
            api=ApiSettings(
                api_keys=ApiKeys(
                    dashscope=config.dashscope_api_key,
                    openai=config.openai_api_key,
                    gemini=config.gemini_api_key,
                    siliconflow=config.siliconflow_api_key,
                    deepseek="",
                    kimi="",
                    glm="",
                    grok="",
                    infistar="",
                    api88="",
                    apimart="",
                    seed="",
                    jimeng_access="",  # default value
                    jimeng_secret=""   # default value
                ),
                api_provider=effective.get("provider") or "dashscope",
                api_base_url=effective.get("base_url") or "",
                api_model=effective.get("model") or config.default_model,
                api_max_tokens=config.max_tokens,
                api_timeout=config.timeout
            ),
            processing=ProcessingSettings(
                processing_chunk_size=config.chunk_size,
                processing_min_score=config.min_score_threshold,
                processing_max_clips=config.max_clips_per_collection,
                processing_max_retries=config.max_retries
            ),
            logs=LogSettings(
                log_level=config.log_level,
                log_retention_days=config.log_retention_days
            ),
            paths=paths
        )
        
        return settings
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get settings: {str(e)}")


@router.post("/paths/data-directory")
async def update_data_directory(
    new_path: str,
    migrate_data: bool = True
):
    """Update data directory"""
    check_desktop_mode()
    
    try:
        from backend.core.desktop_config import set_data_dir
        
        result = set_data_dir(new_path, migrate_data)
        
        if result["success"]:
            return {
                "message": result["message"],
                "new_path": result["new_path"],
                "migrated_files": result.get("migrated_files", []),
                "failed_files": result.get("failed_files", [])
            }
        else:
            raise HTTPException(status_code=400, detail=result["error"])
            
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update data directory: {str(e)}")

@router.get("/paths/data-directory")
async def get_data_directory_info():
    """Get data directory info"""
    check_desktop_mode()
    
    try:
        from backend.core.desktop_config import get_data_dir_info
        
        return get_data_dir_info()
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get data directory info: {str(e)}")

@router.delete("/")
async def clear_settings(
    config: DesktopConfig = Depends(get_desktop_config)
):
    """Clear all settings"""
    try:
        # Reset config to defaults
        config.dashscope_api_key = ""
        config.openai_api_key = ""
        config.gemini_api_key = ""
        config.siliconflow_api_key = ""
        config.jimeng_access_key = ""
        config.jimeng_secret_key = ""
        
        # Save config
        save_desktop_config(config)
        
        return {"message": "Settings cleared", "success": True}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear settings: {str(e)}")

class TestApiRequest(BaseModel):
    provider: str
    api_key: str = ""
    base_url: Optional[str] = None   # only openai: compatible API address
    model: Optional[str] = None      # which model sends the test request (for a compatible API it must be a real model name on the server)

@router.post("/test-api")
async def test_api_connection(request: TestApiRequest):
    """Test API connection"""
    try:
        from backend.core.llm_providers import normalize_base_url, OPENAI_OFFICIAL_BASE_URL
        from backend.core.local_presets import resolve_provider
        from backend.core.cloud_presets import resolve_cloud_preset
        # ollama / lmstudio presets -> openai + default address
        requested_provider = request.provider
        cloud = resolve_cloud_preset(request.provider, request.base_url)
        if cloud:
            resolved_provider, resolved_base_url, _preset = cloud
        else:
            resolved_provider, resolved_base_url, _preset = resolve_provider(request.provider, request.base_url)
        request.provider = resolved_provider
        custom_base_url = normalize_base_url(resolved_base_url) if request.provider == "openai" else ""
        if custom_base_url == OPENAI_OFFICIAL_BASE_URL:
            custom_base_url = ""

        # Only official services validate key format; self-hosted OpenAI-compatible services (Ollama / vLLM etc.) often need no key
        if not custom_base_url:
            if not request.api_key or len(request.api_key.strip()) < 10:
                return {
                    "success": False,
                    "error": "API key is empty or too short, please check your input",
                    "provider": request.provider
                }
            if request.provider in ["dashscope", "openai"] and not request.api_key.startswith("sk-"):
                return {
                    "success": False,
                    "error": f"{request.provider} API key format may be incorrect; usually starts with 'sk-'",
                    "provider": request.provider
                }

        model_kwargs = {"model_name": request.model} if request.model else {}
        
        # Test API connection per provider
        if request.provider == "dashscope":
            from backend.core.llm_providers import DashScopeProvider
            # International endpoint uses compatible mode (#45); empty = China endpoint native SDK
            dashscope_base_url = normalize_base_url(request.base_url) or None
            provider_instance = DashScopeProvider(api_key=request.api_key, base_url=dashscope_base_url, **model_kwargs)
        elif request.provider == "openai":
            from backend.core.llm_providers import OpenAIProvider
            provider_instance = OpenAIProvider(api_key=request.api_key, base_url=custom_base_url or None, **model_kwargs)
        elif request.provider == "gemini":
            from backend.core.llm_providers import GeminiProvider
            provider_instance = GeminiProvider(api_key=request.api_key, **model_kwargs)
        elif request.provider == "siliconflow":
            from backend.core.llm_providers import SiliconFlowProvider
            provider_instance = SiliconFlowProvider(api_key=request.api_key, **model_kwargs)
        else:
            raise HTTPException(status_code=400, detail="Unsupported API provider")
        
        # Test connection
        test_result = provider_instance.test_connection()
        
        if test_result:
            return {
                "success": True,
                "message": "API connection test succeeded",
                "provider": requested_provider
            }
        else:
            # Provide more detailed error info
            error_msg = f"API connection test failed"
            if request.provider == "dashscope":
                error_msg += ". Please check that the API key is correct; DashScope API keys usually start with 'sk-'"
            elif request.provider == "openai" and custom_base_url:
                error_msg += f". Please check whether the address {custom_base_url} is reachable, whether the model name exists, and whether this service requires an API key"
            elif request.provider == "openai":
                error_msg += ". Please check that the API key is correct; OpenAI API keys usually start with 'sk-'"
            elif request.provider == "gemini":
                error_msg += ". Please check that the API key is correct"
            elif request.provider == "siliconflow":
                error_msg += ". Please check that the API key is correct"
            
            return {
                "success": False,
                "error": error_msg,
                "provider": request.provider
            }
            
    except Exception as e:
        logger.error("API connection test exception: %s", sanitize_exception_text(type(e).__name__))
        return {
            "success": False,
            "error": f"API connection test failed: {str(e)}",
            "provider": request.provider
        }

@router.put("/", response_model=Dict[str, Any])
async def update_settings(settings: DesktopSettings):
    """Update settings"""
    try:
        config = get_desktop_config()
        
        # Update config
        config.debug_mode = settings.basic.debug_mode
        config.host = settings.service.host
        config.port = settings.service.port
        config.max_memory_usage = settings.service.max_memory_usage
        
        # Update API settings
        config.dashscope_api_key = settings.api.api_keys.dashscope
        config.openai_api_key = settings.api.api_keys.openai
        config.gemini_api_key = settings.api.api_keys.gemini
        config.siliconflow_api_key = settings.api.api_keys.siliconflow
        config.default_model = settings.api.api_model
        config.max_tokens = settings.api.api_max_tokens
        config.timeout = settings.api.api_timeout
        
        # Update processing settings
        config.chunk_size = settings.processing.processing_chunk_size
        config.min_score_threshold = settings.processing.processing_min_score
        config.max_clips_per_collection = settings.processing.processing_max_clips
        config.max_retries = settings.processing.processing_max_retries
        
        # Update log settings
        config.log_level = settings.logs.log_level
        
        # Save settings to file
        settings_file = config.paths.data_dir / "settings.json"
        with open(settings_file, 'w', encoding='utf-8') as f:
            json.dump(settings.dict(), f, indent=2, ensure_ascii=False)

        # Make this process's LLM manager switch to the new provider / base_url / model immediately (workers auto-reload by mtime)
        try:
            from backend.core.llm_manager import get_llm_manager
            get_llm_manager()._reload_if_settings_changed()
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to refresh the LLM manager (it will auto-reload on next use): %s", sanitize_exception_text(type(e).__name__))
        
        # Important: save the main config file to ensure key settings like API keys are persisted
        from backend.core.desktop_config import save_desktop_config
        if not save_desktop_config(config):
            raise HTTPException(status_code=500, detail="Failed to save the main config file")
        
        return {"message": "Settings updated", "settings_file": str(settings_file)}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update settings: {str(e)}")


@router.post("/reset")
async def reset_settings():
    """Reset settings to defaults"""
    try:
        config = get_desktop_config()
        
        # Delete the settings file
        settings_file = config.paths.data_dir / "settings.json"
        if settings_file.exists():
            settings_file.unlink()
        
        # Reload default config
        config._settings = None
        config._paths = None
        
        return {"message": "Settings reset to defaults"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to reset settings: {str(e)}")


@router.post("/paths/data-directory", response_model=Dict[str, Any])
async def update_data_directory(payload: UpdateDataDirRequest):
    """Update the data directory (optionally migrating data). For the first-run wizard or the settings page."""
    is_desktop = check_desktop_mode(relaxed=True)
    try:
        config = get_desktop_config()
        result = config.set_data_dir(Path(payload.new_data_directory), migrate_from_old=payload.migrate)

        # Return the new path configuration
        paths = {
            "data_directory": str(config.paths.data_dir),
            "cache_directory": str(config.paths.cache_dir),
            "temp_directory": str(config.paths.temp_dir),
            "database_url": config.paths.database_url,
        }

        resp = {"message": "Data directory updated", "result": result, "paths": paths}
        if not is_desktop:
            resp["warning"] = "Not in Desktop mode, but the path configuration was updated"
        return resp
    except Exception as e:
        # Return a more detailed error to help diagnose permission/path/busy issues
        return {
            "message": "Failed to update data directory, but skipped (pilot mode)",
            "error": str(e),
            "hint": "Please make sure the target directory is writable and not restricted by the system; if needed choose a path under your user home directory",
        }


@router.post("/export")
async def export_settings():
    """Export settings"""
    check_desktop_mode()
    
    try:
        config = get_desktop_config()
        settings = await get_settings()
        
        # Create export file
        export_file = config.paths.data_dir / "autovideoclip-settings-export.json"
        with open(export_file, 'w', encoding='utf-8') as f:
            json.dump(settings.dict(), f, indent=2, ensure_ascii=False)
        
        return {
            "message": "Settings exported",
            "export_file": str(export_file),
            "download_url": f"/api/v1/settings/download/{export_file.name}"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to export settings: {str(e)}")


@router.post("/import")
async def import_settings(file: UploadFile = File(...)):
    """Import settings"""
    check_desktop_mode()
    
    try:
        # Read the uploaded file
        content = await file.read()
        settings_data = json.loads(content.decode('utf-8'))
        
        # Validate settings format
        settings = DesktopSettings(**settings_data)
        
        # Update settings
        result = await update_settings(settings)
        
        return {
            "message": "Settings imported",
            "imported_settings": settings.dict()
        }
        
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid settings file format")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to import settings: {str(e)}")


# Removed duplicate test_api_connection function


@router.get("/validation")
async def validate_settings():
    """Validate current settings"""
    try:
        config = get_desktop_config()
        validation_result = config.validate_config()
        
        return {
            "valid": validation_result["valid"],
            "errors": validation_result.get("errors", []),
            "warnings": validation_result.get("warnings", []),
            "recommendations": []
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to validate settings: {str(e)}")


@router.get("/backup")
async def backup_settings():
    """Back up settings"""
    check_desktop_mode()
    
    try:
        config = get_desktop_config()
        backup_dir = config.paths.data_dir / "backups"
        backup_dir.mkdir(exist_ok=True)
        
        # Create backup
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_file = backup_dir / f"settings_backup_{timestamp}.json"
        
        settings = await get_settings()
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(settings.dict(), f, indent=2, ensure_ascii=False)
        
        return {
            "message": "Settings backed up",
            "backup_file": str(backup_file),
            "backup_time": timestamp
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to back up settings: {str(e)}")


@router.get("/backups")
async def list_backups():
    """List all backups"""
    check_desktop_mode()
    
    try:
        config = get_desktop_config()
        backup_dir = config.paths.data_dir / "backups"
        
        if not backup_dir.exists():
            return {"backups": []}
        
        backups = []
        for backup_file in backup_dir.glob("settings_backup_*.json"):
            stat = backup_file.stat()
            backups.append({
                "filename": backup_file.name,
                "path": str(backup_file),
                "size": stat.st_size,
                "created_time": stat.st_ctime,
                "modified_time": stat.st_mtime
            })
        
        # Sort by creation time
        backups.sort(key=lambda x: x["created_time"], reverse=True)
        
        return {"backups": backups}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get backup list: {str(e)}")


def _saved_provider_api_key(settings: DesktopSettings, provider: str) -> str:
    keys = settings.api.api_keys
    return {
        "dashscope": keys.dashscope,
        "openai": keys.openai,
        "gemini": keys.gemini,
        "siliconflow": keys.siliconflow,
        "deepseek": keys.deepseek,
        "kimi": keys.kimi,
        "glm": keys.glm,
        "grok": keys.grok,
        "infistar": keys.infistar,
        "api88": keys.api88,
        "apimart": keys.apimart,
        "seed": keys.seed,
    }.get((provider or "").strip().lower(), "") or ""


@router.get("/available-models")
async def get_available_models(
    provider: str = "",
    base_url: str = "",
    api_key: str = "",
    refresh: bool = False,
):
    """
    Cloud provider model dropdown.

    Without a key returns the built-in common list; with a key (request param or saved settings)
    calls the provider's `/models` and merges the models available to the account. `refresh=1` skips the cache.
    """
    try:
        from backend.core.model_catalog import list_available_models

        key = (api_key or "").strip()
        if not key and provider:
            try:
                settings = await get_settings()
                key = _saved_provider_api_key(settings, provider).strip()
            except Exception:  # noqa: BLE001
                key = ""
        result = await list_available_models(
            provider=provider,
            api_key=key,
            base_url=base_url,
            refresh=refresh,
        )
        # Old callers only recognize {models: {provider: [{name, ...}]}}; new fields are returned alongside
        legacy = {
            name: [{"name": model, "display_name": model} for model in models]
            for name, models in result.catalog.items()
        }
        payload = result.as_dict()
        payload["models_by_provider"] = legacy
        return payload
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get model list: {sanitize_exception_text(e)}")


@router.get("/local-presets")
async def get_local_presets():
    """Local model presets (Ollama / LM Studio): default address, default model, prompt copy."""
    from backend.core.local_presets import presets_as_dicts
    return {"presets": presets_as_dicts()}


@router.get("/provider-quality")
def get_provider_quality():
    """Static success and latency tiers. No live provider or PostHog request."""
    from backend.core.provider_quality import public_payload
    return public_payload()


@router.get("/compatible-models")
async def list_compatible_models(base_url: str = "", provider: str = "openai", api_key: str = ""):
    """
    List the models actually provided by an OpenAI-compatible service (Ollama / LM Studio / vLLM…) (GET {base_url}/models).
    When the settings page selects a local preset, use this to fill the model dropdown so users do not have to type names like `qwen2.5:7b`.
    """
    from backend.core.local_presets import resolve_provider
    from backend.core.llm_providers import normalize_base_url, is_local_url
    _provider, resolved_base_url, _preset = resolve_provider(provider, base_url)
    url = normalize_base_url(resolved_base_url)
    if not url:
        raise HTTPException(status_code=400, detail="Missing base_url")
    try:
        from starlette.concurrency import run_in_threadpool
        from backend.core.provider_model_fetch import list_account_models
        key = (api_key or "").strip()
        result = await run_in_threadpool(
            list_account_models,
            base_url=url,
            api_key=key,
            provider=provider or "openai",
            auth="none" if is_local_url(url) and not key else "api_key",
        )
        return {
            "reachable": result.ok,
            "base_url": url,
            "models": result.models,
            "error": result.hint_key if not result.ok else None,
            "hint_key": result.hint_key,
            "error_type": result.error_type,
            "message_key": result.message_key,
            "recommended": result.recommended,
            "truncated": result.truncated,
            "base_url_host": result.base_url_host,
        }
    except Exception:  # noqa: BLE001
        from backend.core.upstream_errors import hint_key_for
        return {
            "reachable": False, "base_url": url, "models": [],
            "error": hint_key_for("connection"), "hint_key": hint_key_for("connection"),
            "error_type": "connection",
        }


@router.get("/current-provider")
async def get_current_provider():
    """Get current provider info"""
    try:
        # Base this on the LLM manager's actual state (it reads the settings.json saved by the settings page),
        # rather than always returning dashscope — otherwise the settings page would "jump back" to Qwen on every open.
        from backend.core.llm_manager import get_llm_manager
        info = get_llm_manager().get_current_provider_info()
        display_name = info.get("display_name") or info.get("provider") or "Alibaba Qwen"
        provider_info = {
            "provider": info.get("provider") or "dashscope",
            "model": info.get("model") or "qwen-plus",
            "available": bool(info.get("available")),
            "display_name": display_name,
            "description": f"{display_name} model service",
        }
        if info.get("base_url"):
            provider_info["base_url"] = info["base_url"]
        
        return provider_info
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get current provider info: {str(e)}")


@router.post("/restore/{backup_filename}")
async def restore_backup(backup_filename: str):
    """Restore settings from a backup"""
    check_desktop_mode()
    
    try:
        config = get_desktop_config()
        backup_file = config.paths.data_dir / "backups" / backup_filename
        
        if not backup_file.exists():
            raise HTTPException(status_code=404, detail="Backup file not found")
        
        # Read the backup file
        with open(backup_file, 'r', encoding='utf-8') as f:
            settings_data = json.load(f)
        
        # Validate and restore settings
        settings = DesktopSettings(**settings_data)
        result = await update_settings(settings)
        
        return {
            "message": "Settings restored",
            "restored_from": backup_filename,
            "restored_settings": settings.dict()
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to restore settings: {str(e)}")


@router.post("/sync-config")
async def sync_config():
    """Manually sync client config to the backend"""
    check_desktop_mode()
    
    try:
        if config_sync_service.sync_from_client():
            return {
                "status": "success",
                "message": "Config synced"
            }
        else:
            return {
                "status": "error",
                "message": "Config sync failed"
            }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Config sync failed: {str(e)}"
        }


@router.get("/config-status")
async def get_config_status():
    """Get config sync status"""
    check_desktop_mode()
    
    try:
        client_time = config_sync_service.get_client_config_timestamp()
        backup_time = config_sync_service.get_backup_config_timestamp()
        sync_needed = config_sync_service.is_sync_needed()
        
        return {
            "client_config_exists": client_time is not None,
            "backup_config_exists": backup_time is not None,
            "client_config_time": client_time,
            "backup_config_time": backup_time,
            "sync_needed": sync_needed,
            "client_config_path": str(config_sync_service.client_config_path),
            "backup_config_path": str(config_sync_service.backup_config_path)
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to get config status: {str(e)}"
        }
