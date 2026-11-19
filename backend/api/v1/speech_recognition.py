"""
Speech recognition configuration API
"""
from fastapi import APIRouter, HTTPException, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import logging
from backend.utils.speech_recognizer import (
    SpeechRecognitionMethod, 
    SpeechRecognitionConfig, 
    SpeechRecognizer,
    generate_subtitle_for_video
)
from backend.core.desktop_config import (
    get_desktop_config, 
    save_desktop_config, 
    DesktopConfig,
    SpeechRecognitionSettings,
    WhisperConfig,
    ApiConfig
)
from backend.services.whisper_model_manager import (
    get_model_manager, 
    WhisperModelManager,
    ModelInfo,
    ModelStatus
)
from backend.services.speech_config_validator import get_config_validator
from backend.core import sentry_setup

logger = logging.getLogger(__name__)
router = APIRouter()

# Global speech recognizer instance
_speech_recognizer: Optional[SpeechRecognizer] = None

def get_speech_recognizer() -> SpeechRecognizer:
    """Get the speech recognizer instance"""
    global _speech_recognizer
    if _speech_recognizer is None:
        _speech_recognizer = SpeechRecognizer()
    return _speech_recognizer


# ===== Whisper runtime (on-demand install) =====

@router.get("/sensevoice/status")
async def sensevoice_status():
    from backend.services import sensevoice_runtime
    return sensevoice_runtime.status()


@router.post("/sensevoice/prepare")
async def sensevoice_prepare():
    from backend.services import sensevoice_runtime
    try:
        return sensevoice_runtime.start_prepare()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/sensevoice")
async def sensevoice_uninstall():
    from backend.services import sensevoice_runtime
    try:
        return sensevoice_runtime.uninstall()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

@router.get("/whisper/runtime-status")
async def whisper_runtime_status():
    """Whisper runtime install status (polled by the frontend)."""
    from backend.services import whisper_runtime
    return whisper_runtime.get_status()


@router.post("/whisper/install")
async def whisper_install():
    """Start installing the Whisper runtime in the background (faster-whisper, cross-platform)."""
    from backend.services import whisper_runtime
    return whisper_runtime.start_install()


@router.post("/whisper/uninstall")
async def whisper_uninstall():
    """Uninstall the Whisper runtime (does not affect downloaded model cache; it can be removed separately)."""
    from backend.services import whisper_runtime
    return whisper_runtime.uninstall()

class SpeechConfigRequest(BaseModel):
    """Speech recognition config request"""
    method: str
    model: Optional[str] = "base"
    openaiApiKey: Optional[str] = None
    aliyunApiKey: Optional[str] = None
    enableTimestamps: Optional[bool] = True
    enablePunctuation: Optional[bool] = True
    enableSpeakerDiarization: Optional[bool] = False
    enableFallback: Optional[bool] = True
    fallbackMethod: Optional[str] = "whisper_local"
    timeout: Optional[int] = 1800  # 30 minutes, suitable for Whisper model processing
    outputFormat: Optional[str] = "srt"

class SpeechConfigResponse(BaseModel):
    """Speech recognition config response"""
    method: str
    model: str
    openaiApiKey: Optional[str] = None
    aliyunApiKey: Optional[str] = None
    enableTimestamps: bool
    enablePunctuation: bool
    enableSpeakerDiarization: bool
    enableFallback: bool
    fallbackMethod: str
    timeout: int
    outputFormat: str

class SpeechMethodStatus(BaseModel):
    """Speech recognition method status"""
    method: str
    available: bool
    message: Optional[str] = None

class WhisperModelInfo(BaseModel):
    """Whisper model info"""
    name: str
    size: str
    sizeBytes: int
    description: str
    accuracy: str
    speed: str
    status: str  # 'available' | 'downloading' | 'downloaded' | 'error'
    downloadProgress: Optional[int] = None

class TestSpeechServiceRequest(BaseModel):
    """Test speech recognition service request"""
    method: str

class TestSpeechServiceResponse(BaseModel):
    """Test speech recognition service response"""
    success: bool
    message: str

class DownloadModelRequest(BaseModel):
    """Download model request"""
    model: str

@router.get("/speech-recognition/config")
async def get_speech_config(config: DesktopConfig = Depends(get_desktop_config)):
    """Get speech recognition config"""
    try:
        speech_config = config.speech_recognition
        
        return {
            "method": speech_config.method,
            "whisper_config": {
                "model_name": speech_config.whisper_config.model_name,
                "language": speech_config.whisper_config.language,
                "custom_models_dir": speech_config.whisper_config.custom_models_dir,
                "enable_timestamps": speech_config.whisper_config.enable_timestamps,
                "enable_punctuation": speech_config.whisper_config.enable_punctuation,
                "enable_speaker_diarization": speech_config.whisper_config.enable_speaker_diarization,
                "timeout": speech_config.whisper_config.timeout
            },
            "openai_config": {
                "api_key": speech_config.openai_config.api_key,
                "language": speech_config.openai_config.language,
                "enable_timestamps": speech_config.openai_config.enable_timestamps,
                "enable_punctuation": speech_config.openai_config.enable_punctuation
            },
            "azure_config": {
                "api_key": speech_config.azure_config.api_key,
                "region": speech_config.azure_config.region,
                "language": speech_config.azure_config.language,
                "enable_timestamps": speech_config.azure_config.enable_timestamps,
                "enable_punctuation": speech_config.azure_config.enable_punctuation
            },
            "google_config": {
                "api_key": speech_config.google_config.api_key,
                "language": speech_config.google_config.language,
                "enable_timestamps": speech_config.google_config.enable_timestamps,
                "enable_punctuation": speech_config.google_config.enable_punctuation
            },
            "aliyun_config": {
                "api_key": speech_config.aliyun_config.api_key,
                "language": speech_config.aliyun_config.language,
                "enable_timestamps": speech_config.aliyun_config.enable_timestamps,
                "enable_punctuation": speech_config.aliyun_config.enable_punctuation
            },
            "custom_api_config": {
                "api_key": speech_config.custom_api_config.api_key,
                "endpoint": speech_config.custom_api_config.endpoint,
                "language": speech_config.custom_api_config.language,
                "enable_timestamps": speech_config.custom_api_config.enable_timestamps,
                "enable_punctuation": speech_config.custom_api_config.enable_punctuation
            },
            "enable_fallback": speech_config.enable_fallback,
            "fallback_method": speech_config.fallback_method,
            "output_format": speech_config.output_format
        }
    except Exception as e:
        logger.error(f"Failed to get speech recognition config: {e}")
        raise HTTPException(status_code=500, detail="Failed to get speech recognition config")

class SpeechConfigUpdateRequest(BaseModel):
    """Speech recognition config update request"""
    method: str
    whisper_config: Optional[Dict[str, Any]] = None
    openai_config: Optional[Dict[str, Any]] = None
    azure_config: Optional[Dict[str, Any]] = None
    google_config: Optional[Dict[str, Any]] = None
    aliyun_config: Optional[Dict[str, Any]] = None
    custom_api_config: Optional[Dict[str, Any]] = None
    enable_fallback: Optional[bool] = None
    fallback_method: Optional[str] = None
    output_format: Optional[str] = None


@router.put("/speech-recognition/config")
async def update_speech_config(
    request: SpeechConfigUpdateRequest,
    config: DesktopConfig = Depends(get_desktop_config)
):
    """Update speech recognition config"""
    try:
        # Validate method
        try:
            method = SpeechRecognitionMethod(request.method)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unsupported speech recognition method: {request.method}")
        
        # Validate fallback method
        if request.fallback_method:
            try:
                fallback_method = SpeechRecognitionMethod(request.fallback_method)
            except ValueError:
                raise HTTPException(status_code=400, detail=f"Unsupported fallback method: {request.fallback_method}")
        
        # Update config
        speech_config = config.speech_recognition
        speech_config.method = request.method
        
        # Update Whisper config
        if request.whisper_config:
            for key, value in request.whisper_config.items():
                if hasattr(speech_config.whisper_config, key):
                    setattr(speech_config.whisper_config, key, value)
        
        # Update API config
        if request.openai_config:
            for key, value in request.openai_config.items():
                if hasattr(speech_config.openai_config, key):
                    setattr(speech_config.openai_config, key, value)
        
        if request.azure_config:
            for key, value in request.azure_config.items():
                if hasattr(speech_config.azure_config, key):
                    setattr(speech_config.azure_config, key, value)
        
        if request.google_config:
            for key, value in request.google_config.items():
                if hasattr(speech_config.google_config, key):
                    setattr(speech_config.google_config, key, value)
        
        if request.aliyun_config:
            for key, value in request.aliyun_config.items():
                if hasattr(speech_config.aliyun_config, key):
                    setattr(speech_config.aliyun_config, key, value)
        
        if request.custom_api_config:
            for key, value in request.custom_api_config.items():
                if hasattr(speech_config.custom_api_config, key):
                    setattr(speech_config.custom_api_config, key, value)
        
        # Update other config
        if request.enable_fallback is not None:
            speech_config.enable_fallback = request.enable_fallback
        
        if request.fallback_method:
            speech_config.fallback_method = request.fallback_method
        
        if request.output_format:
            speech_config.output_format = request.output_format
        
        # Save config
        if save_desktop_config(config):
            logger.info(f"Speech recognition config updated: {request.method}")
            return {"message": "Speech recognition config updated", "success": True}
        else:
            raise HTTPException(status_code=500, detail="Failed to save config")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to update speech recognition config: {e}")
        raise HTTPException(status_code=500, detail="Failed to update speech recognition config")

@router.get("/speech-methods-status", response_model=List[SpeechMethodStatus])
async def get_speech_methods_status():
    """Get speech recognition method status"""
    try:
        recognizer = get_speech_recognizer()
        available_methods = recognizer.get_available_methods()
        
        status_list = []
        for method in SpeechRecognitionMethod:
            available = available_methods.get(method, False)
            message = None
            
            if not available:
                if method == SpeechRecognitionMethod.WHISPER_LOCAL:
                    message = "Whisper needs to be installed"
                elif method == SpeechRecognitionMethod.OPENAI_API:
                    message = "OpenAI API key needs to be configured"
                elif method == SpeechRecognitionMethod.ALIYUN_SPEECH:
                    message = "Aliyun API key needs to be configured"
                else:
                    message = "Service unavailable"
            
            status_list.append(SpeechMethodStatus(
                method=method.value,
                available=available,
                message=message
            ))
        
        return status_list
        
    except Exception as e:
        logger.error(f"Failed to get speech recognition method status: {e}")
        raise HTTPException(status_code=500, detail="Failed to get speech recognition method status")

class WhisperModelSourceRequest(BaseModel):
    source: str


@router.get("/whisper/model-source")
async def get_whisper_model_source():
    """Model download source (E3): auto probes hf-mirror / huggingface official / hf-mirror mirror."""
    from backend.services import whisper_model_manager as wmm
    return {"source": wmm.saved_model_source(), "effective": wmm.model_source(), "options": list(wmm.MODEL_SOURCES)}


@router.put("/whisper/model-source")
async def put_whisper_model_source(request: WhisperModelSourceRequest):
    from backend.services import whisper_model_manager as wmm
    try:
        return {"source": wmm.save_model_source(request.source)}
    except ValueError:
        raise HTTPException(status_code=422, detail="Unsupported model download source")


@router.get("/whisper-models")
async def get_whisper_models():
    """Get Whisper model info"""
    try:
        model_manager = get_model_manager()
        models_info = model_manager.get_all_models_info()
        
        models = []
        for model_info in models_info:
            models.append({
                "name": model_info.name,
                "size": model_info.size,
                "sizeBytes": model_info.size_bytes,
                "description": model_info.description,
                "accuracy": model_info.accuracy,
                "speed": model_info.speed,
                "status": model_info.status.value,
                "downloadProgress": model_info.download_progress,
                "localPath": model_info.local_path,
                "errorMessage": model_info.error_message,
                "errorCode": model_info.error_code,
                "source": model_info.source,
            })
        
        return models
        
    except Exception as e:
        logger.error(f"Failed to get Whisper model info: {e}")
        raise HTTPException(status_code=500, detail="Failed to get Whisper model info")

@router.post("/test-speech-service", response_model=TestSpeechServiceResponse)
async def test_speech_service(request: TestSpeechServiceRequest):
    """Test speech recognition service"""
    try:
        recognizer = get_speech_recognizer()
        available_methods = recognizer.get_available_methods()
        
        try:
            method = SpeechRecognitionMethod(request.method)
        except ValueError:
            return TestSpeechServiceResponse(
                success=False,
                message=f"Unsupported speech recognition method: {request.method}"
            )
        
        if available_methods.get(method, False):
            return TestSpeechServiceResponse(
                success=True,
                message=f"{method.value} service is available"
            )
        else:
            return TestSpeechServiceResponse(
                success=False,
                message=f"{method.value} service is unavailable, please check the configuration"
            )
            
    except Exception as e:
        logger.error(f"Failed to test speech recognition service: {e}")
        return TestSpeechServiceResponse(
            success=False,
            message=f"Test failed: {str(e)}"
        )

# QA switch for on-device acceptance of (download request 500 -> failed, retry, no resend).
# Off unless this exact env var is "1" when the app starts; release builds never set it (locked by a test).
QA_FAIL_MODEL_DOWNLOAD_ENV = "AUTOVIDEOCLIP_QA_FAIL_MODEL_DOWNLOAD"


QA_MOCK_DOWNLOAD_DETAIL = "qa_mock_model_download_500"


def qa_fail_model_download() -> bool:
    import os
    return os.environ.get(QA_FAIL_MODEL_DOWNLOAD_ENV) == "1"


def qa_simulated_download_failure(model: str) -> JSONResponse:
    """The one place the QA switch acts (#405, #406): the local log says it is a QA simulation; the 500 is a plain
    response, not an HTTPException, so FastApiIntegration reports nothing to Sentry; and no success-rate telemetry
    is emitted. Only the model download request goes through here."""
    logger.warning("QA simulated failure: %s=1, model download request for %s answered 500; "
                   "not reported to Sentry, no success-rate telemetry", QA_FAIL_MODEL_DOWNLOAD_ENV, model)
    return JSONResponse(status_code=500, content={"detail": QA_MOCK_DOWNLOAD_DETAIL})


@router.post("/whisper-models/download")
async def download_whisper_model(request: DownloadModelRequest):
    """Start downloading a Whisper model (background).

    200 status=installed: the full model already exists locally. 202 status=downloading: started or downloading,
    check GET /whisper-models/{name}/status for the result. Cannot claim "download complete" here (RC156 Win QA #5).
    """
    if qa_fail_model_download():
        return qa_simulated_download_failure(request.model)
    try:
        model_manager = get_model_manager()
        state = await model_manager.download_model(request.model)
    except Exception as e:
        logger.error(f"Failed to download Whisper model: {e}")
        # the one Studio capture path (consent, scope, tag whitelist); production Sentry has no
        # Starlette integration, so the raised HTTPException alone is never reported. The QA simulation never comes here.
        sentry_setup.capture_studio_exception(e, phase="model_download", http_status=500)
        raise HTTPException(status_code=500, detail=f"Failed to download Whisper model: {str(e)}")
    if state == "installed":
        return {"status": "installed", "model": request.model, "message": f"Model {request.model} already exists", "success": True}
    return JSONResponse(status_code=202, content={
        "status": "downloading", "model": request.model,
        "message": f"Started downloading model {request.model}", "success": True,
    })

@router.delete("/whisper-models/{model_name}")
async def delete_whisper_model(model_name: str):
    """Delete Whisper model"""
    try:
        model_manager = get_model_manager()
        
        # Check whether the model exists
        model_info = model_manager.get_model_info(model_name)
        if not model_info or model_info.status != ModelStatus.DOWNLOADED:
            raise HTTPException(status_code=404, detail=f"Model {model_name} does not exist")
        
        # Delete model
        success = model_manager.delete_model(model_name)
        
        if success:
            return {"message": f"Model {model_name} deleted", "success": True}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to delete model {model_name}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete Whisper model: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to delete Whisper model: {str(e)}")


@router.get("/whisper-models/{model_name}/status")
async def get_model_status(model_name: str):
    """Get model status"""
    try:
        model_manager = get_model_manager()
        model_info = model_manager.get_model_info(model_name)
        
        if not model_info:
            raise HTTPException(status_code=404, detail=f"Model {model_name} does not exist")
        
        return {
            "name": model_info.name,
            "status": model_info.status.value,
            "downloadProgress": model_info.download_progress,
            "localPath": model_info.local_path,
            "errorMessage": model_info.error_message,
            "errorCode": model_info.error_code,
            "source": model_info.source,
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get model status: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get model status: {str(e)}")


@router.post("/whisper-models/{model_name}/cancel-download")
async def cancel_model_download(model_name: str):
    """Cancel model download"""
    try:
        model_manager = get_model_manager()
        success = model_manager.cancel_download(model_name)
        
        if success:
            return {"message": f"Cancelled download of model {model_name}", "success": True}
        else:
            return {"message": f"Model {model_name} is not downloading", "success": False}
        
    except Exception as e:
        logger.error(f"Failed to cancel model download: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to cancel model download: {str(e)}")


@router.post("/speech-recognition/validate")
async def validate_speech_config(
    request: SpeechConfigUpdateRequest,
    config: DesktopConfig = Depends(get_desktop_config)
):
    """Validate speech transcription config"""
    try:
        # Create a temporary config object for validation
        temp_config = config.speech_recognition.copy()
        
        # Update temporary config
        temp_config.method = request.method
        
        if request.whisper_config:
            for key, value in request.whisper_config.items():
                if hasattr(temp_config.whisper_config, key):
                    setattr(temp_config.whisper_config, key, value)
        
        if request.openai_config:
            for key, value in request.openai_config.items():
                if hasattr(temp_config.openai_config, key):
                    setattr(temp_config.openai_config, key, value)
        
        if request.azure_config:
            for key, value in request.azure_config.items():
                if hasattr(temp_config.azure_config, key):
                    setattr(temp_config.azure_config, key, value)
        
        if request.google_config:
            for key, value in request.google_config.items():
                if hasattr(temp_config.google_config, key):
                    setattr(temp_config.google_config, key, value)
        
        if request.aliyun_config:
            for key, value in request.aliyun_config.items():
                if hasattr(temp_config.aliyun_config, key):
                    setattr(temp_config.aliyun_config, key, value)
        
        if request.custom_api_config:
            for key, value in request.custom_api_config.items():
                if hasattr(temp_config.custom_api_config, key):
                    setattr(temp_config.custom_api_config, key, value)
        
        if request.enable_fallback is not None:
            temp_config.enable_fallback = request.enable_fallback
        
        if request.fallback_method:
            temp_config.fallback_method = request.fallback_method
        
        if request.output_format:
            temp_config.output_format = request.output_format
        
        # Validate config
        validator = get_config_validator()
        validation_result = validator.validate_config(temp_config)
        
        return {
            "valid": validation_result["valid"],
            "errors": validation_result["errors"],
            "warnings": validation_result["warnings"],
            "recommendations": validation_result["recommendations"]
        }
        
    except Exception as e:
        logger.error(f"Failed to validate speech transcription config: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to validate config: {str(e)}")


@router.get("/speech-recognition/recommendations")
async def get_speech_recommendations():
    """Get speech transcription config recommendations"""
    try:
        recommendations = {
            "scenarios": {
                "Beginners": {
                    "method": "whisper_local",
                    "model": "base",
                    "description": "Free and offline, balanced accuracy and speed"
                },
                "Professionals": {
                    "method": "openai_api",
                    "model": "whisper-1",
                    "description": "Highest accuracy, suitable for important content"
                },
                "Chinese content": {
                    "method": "aliyun_speech",
                    "model": "default",
                    "description": "Better Chinese recognition results"
                },
                "Enterprise applications": {
                    "method": "azure_speech",
                    "model": "default",
                    "description": "Enterprise-grade service, stable and reliable"
                }
            },
            "model_guide": {
                "tiny": {
                    "size": "39 MB",
                    "speed": "Fastest",
                    "accuracy": "Lower",
                    "recommended_for": "Real-time processing, quick preview"
                },
                "base": {
                    "size": "74 MB",
                    "speed": "Fast",
                    "accuracy": "Medium",
                    "recommended_for": "Daily use, balanced choice"
                },
                "small": {
                    "size": "244 MB",
                    "speed": "Medium",
                    "accuracy": "Good",
                    "recommended_for": "Important content, knowledge videos"
                },
                "medium": {
                    "size": "769 MB",
                    "speed": "Slower",
                    "accuracy": "High",
                    "recommended_for": "Professional use, lecture content"
                },
                "large": {
                    "size": "1550 MB",
                    "speed": "Slowest",
                    "accuracy": "Highest",
                    "recommended_for": "Important projects, highest quality requirements"
                }
            },
            "tips": [
                "For first-time use, download the base model first for testing",
                "If the network is unstable, consider using the local Whisper model",
                "Recommended to use the Aliyun speech recognition service for Chinese content",
                "Enable the fallback mechanism for important projects",
                "Speaker diarization increases processing time",
                "Check the model status periodically to ensure the service is available"
            ]
        }
        
        return recommendations
        
    except Exception as e:
        logger.error(f"Failed to get config recommendations: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to get recommendations: {str(e)}")
