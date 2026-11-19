import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import { pipInstallErrorText } from '../utils/pipInstallError'
import { whisperModelErrorText } from '../utils/whisperModelError'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Popconfirm, Select, message } from 'antd'
import { speechApi, WhisperRuntimeStatus, WhisperModel, WhisperModelSource } from '../services/api'
import { Btn, Row } from '../ui'
import LocalModelPrepare from '../features/settings/LocalModelPrepare'

interface SpeechRecognitionConfigProps {
  hideProvider?: boolean
  selectedModel?: string
  onModelChange?: (model: string) => void
}

// Whisper runtime + ModelManage — Calm Premium Row layout（See DESIGN.md）
const SpeechRecognitionConfig: React.FC<SpeechRecognitionConfigProps> = ({ selectedModel = 'base', onModelChange, hideProvider = false }) => {
  useTranslation()
  const [runtime, setRuntime] = useState<WhisperRuntimeStatus | null>(null)
  const [models, setModels] = useState<WhisperModel[]>([])
  const [loading, setLoading] = useState(true)
  const pendingModel = useRef<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const timer = useRef<number | null>(null)
  const [modelSource, setModelSource] = useState<WhisperModelSource>('auto')
  useEffect(() => { speechApi.getModelSource().then(v => setModelSource(v.source)).catch(() => undefined) }, [])
  const changeModelSource = async (source: WhisperModelSource) => {
    const previous = modelSource
    setModelSource(source)
    try { await speechApi.setModelSource(source) } catch { setModelSource(previous); message.error(t('Save failed. Please try again.')) }
  }

  const refresh = useCallback(async () => {
    try {
      const [rt, ms] = await Promise.all([speechApi.getRuntimeStatus(), speechApi.getModels()])
      setRuntime(rt)
      setModels(Array.isArray(ms) ? ms : [])
    } catch {
      // Keep the existing status until the next refresh.
    } finally {
      setLoading(false)
    }
  }, [])

  // InstallIn the middle or there isModelDownloadingTime，AddFastPolling
  const needsFastPoll = (rt: WhisperRuntimeStatus | null, ms: WhisperModel[]) =>
    rt?.status === 'installing' || ms.some((m) => m.status === 'downloading')

  useEffect(() => {
    refresh()
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [refresh])

  useEffect(() => {
    if (timer.current) window.clearInterval(timer.current)
    timer.current = window.setInterval(refresh, needsFastPoll(runtime, models) ? 2000 : 15000)
    return () => { if (timer.current) window.clearInterval(timer.current) }
  }, [runtime, models, refresh])

  const handleInstall = async () => {
    try {
      await speechApi.installRuntime()
      message.info(t("Installation started"))
      setRuntime((p) => (p ? { ...p, status: 'installing', progress: 5 } : p))
      refresh()
    } catch (e: any) {
      pendingModel.current = null
      setPreparing(false)
      message.error(e?.response?.data?.detail || t("Installation failed"))
    }
  }

  const handleUninstall = async () => {
    try {
      await speechApi.uninstallRuntime()
      message.success(t("Uninstalled"))
      refresh()
    } catch {
      message.error(t("Uninstall failed"))
    }
  }

  const handleDownload = async (model: string) => {
    try {
      const result = await speechApi.downloadModel(model)
      if (result?.status !== 'installed') {
        message.info(t("Downloading {{value1}}", { value1: model }))
        setModels((prev) => prev.map((m) => (m.name === model ? { ...m, status: 'downloading' } : m)))
      }
      refresh()
    } catch (e: any) {
      message.error(e?.response?.data?.detail || t("Download failed"))
    }
  }

  const handleDelete = async (model: string) => {
    try {
      await speechApi.deleteModel(model)
      message.success(t("Deleted {{value1}}", { value1: model }))
      refresh()
    } catch {
      message.error(t("Delete failed"))
    }
  }

  useEffect(() => {
    if (runtime?.status === 'error') { pendingModel.current = null; setPreparing(false) }
    if (runtime?.status === 'installed' && pendingModel.current) {
      const model = pendingModel.current
      pendingModel.current = null
      void handleDownload(model).finally(() => setPreparing(false))
    }
  }, [runtime?.status])

  const selected = models.find(m => m.name === selectedModel)
  const installed = runtime?.status === 'installed'
  const installing = runtime?.status === 'installing'
  const downloading = selected?.status === 'downloading'
  const ready = installed && selected?.status === 'downloaded'
  const prepare = async () => {
    setPreparing(true)
    if (installed) {
      await handleDownload(selectedModel)
      setPreparing(false)
    } else {
      pendingModel.current = selectedModel
      await handleInstall()
    }
  }

  return <div className="ac-rows">
    {!hideProvider && <Row label={t('Provider')} hint={t('Transcribe audio locally. No audio uploads or API key required.')}>
      <span>{t('Whisper · Local')}</span>
    </Row>}
    <Row wide label={t('Transcription model')} hint={t('Used when a video has no subtitles. Larger models generally improve accuracy but require more time and memory.')}>
      <Select aria-label={t('Transcription model')} style={{ width: '100%' }} value={selectedModel} loading={loading} disabled={preparing || installing || downloading}
        options={(models.length ? models.map(m => ({ value: m.name, label: `${m.name} · ${m.size}` })) : ['tiny', 'base', 'small', 'medium', 'large-v3'].map(name => ({ value: name, label: name })))}
        onChange={onModelChange} />
    </Row>
    <LocalModelPrepare
      ready={ready}
      preparing={installing || downloading || preparing}
      progress={installing ? runtime?.progress ?? 5 : selected?.downloadProgress ?? 0}
      hint={runtime?.status === 'error' ? pipInstallErrorText(t, runtime) : selected?.status === 'error' && installed ? whisperModelErrorText(t, selected) : t("A video without subtitles has to download the local transcription component the first time (about 220 MB, about 15 minutes on a slow network). If you don't want to wait, switch to cloud transcription.")}
      busyHint={installing ? t('Preparing components…') : t('Downloading model…')}
      disabled={runtime?.platform_supported === false || loading || !runtime}
      onPrepare={() => void prepare()} />
    {!runtime && !loading && <p className="ac-note">{t('Local model status is temporarily unavailable.')} <Btn variant="text" size="sm" onClick={() => void refresh()}>{t('Retry')}</Btn></p>}
    <details className="ac-disclosure"><summary>{t('Manage local models')}</summary>
      <Row label={t('Model download source')} hint={t('Auto: switches to the hf-mirror mirror when the official source is unreachable.')}>
        <Select aria-label={t('Model download source')} style={{ minWidth: 180 }} value={modelSource} disabled={downloading}
          options={[{ value: 'auto', label: t('Auto') }, { value: 'huggingface', label: 'Hugging Face' }, { value: 'hf-mirror', label: t('hf-mirror (mirror)') }]}
          onChange={value => void changeModelSource(value as WhisperModelSource)} />
      </Row>
      {models.filter(m => m.status === 'downloaded').map(m => <Row key={m.name} label={`${m.name} · ${m.size}`}>
        <Popconfirm title={t('Delete model {{value1}}?', { value1: m.name })} onConfirm={() => handleDelete(m.name)} okText={t('Delete')} cancelText={t('Cancel')}><Btn variant="danger" size="sm">{t('Delete')}</Btn></Popconfirm>
      </Row>)}
      {installed && <Row label={t('Local transcription components')}><Popconfirm title={t('Uninstall Whisper runtime? Downloaded models will be kept.')} onConfirm={handleUninstall} okText={t('Uninstall')} cancelText={t('Cancel')}><Btn variant="danger" size="sm">{t('Uninstall')}</Btn></Popconfirm></Row>}
      {runtime?.log_tail && <pre className="ac-note" style={{ maxHeight: 120, overflow: 'auto', whiteSpace: 'pre-wrap' }}>{runtime.log_tail}</pre>}
    </details>
  </div>
}

export default SpeechRecognitionConfig
