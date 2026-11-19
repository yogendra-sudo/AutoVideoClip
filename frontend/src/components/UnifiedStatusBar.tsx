import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
/**
 * UnifiedStatusColumn component - ReplaceOld and complexProgressSystem
 * SupportDownloading、Processing、Doneetc.StatusUniformityShow
 */

import React, { useEffect, useState } from 'react'
import { Progress, Typography } from 'antd'
import { useSimpleProgressStore, getStageDisplayName, getStageColor, isCompleted, isFailed } from '../stores/useSimpleProgressStore'
import { apiConfigManager } from '../utils/apiConfig'
import { displayedDownloadPercent, readDownloadProgress } from '../utils/downloadProgress'
import { getKeepAwakeController } from '../features/studio/keepAwake'

const { Text } = Typography

interface UnifiedStatusBarProps {
  projectId: string
  status: string
  downloadProgress?: number
  onStatusChange?: (status: string) => void
  onDownloadProgressUpdate?: (progress: number) => void
}

export const UnifiedStatusBar: React.FC<UnifiedStatusBarProps> = ({
  projectId,
  status,
  downloadProgress = 0,
  onStatusChange,
  onDownloadProgressUpdate
}) => {
  useTranslation()
  const { getProgress, startPolling, stopPolling } = useSimpleProgressStore()
  const [isPolling, setIsPolling] = useState(false)
  // null：Not yet read from the interface this timeProgress。Not usable useState(downloadProgress)，
  // Otherwise, when the card is mounted for the first time 5% The placeholder will remainGet it from theHere。
  const [polledProgress, setPolledProgress] = useState<number | null>(null)
  const shownDownloadProgress = displayedDownloadPercent(downloadProgress, polledProgress)

  useEffect(() => {
    setPolledProgress(null)
  }, [projectId])
  
  const progress = getProgress(projectId)

  // Based onStatusDecide whether to poll
  useEffect(() => {
    // If it already existsProgressand has reached the final state，Do not start polling
    if (progress && (isCompleted(progress.stage) || isFailed(progress.message))) {
      if (isPolling) {
        console.log(`ProgressFinal status，Stop Polling: ${projectId}`)
        stopPolling()
        setIsPolling(false)
      }
      return
    }

    if ((status === 'processing' || status === 'pending') && !isPolling) {
      console.log(`Start polling processProgress: ${projectId}`)
      startPolling([projectId], 5000) // 5secondsPoll once，Reduce frequent requests
      setIsPolling(true)
    } else if (status !== 'processing' && status !== 'pending' && isPolling) {
      console.log(`Stop polling processingProgress: ${projectId}`)
      stopPolling()
      setIsPolling(false)
    }

    return () => {
      if (isPolling) {
        console.log(`Clear polling: ${projectId}`)
        stopPolling()
        setIsPolling(false)
      }
    }
  }, [status, projectId, isPolling, startPolling, stopPolling, progress])


  // Report this card's running state to keep-awake (project store also covers Home).
  useEffect(() => {
    const producing = status === 'processing' || status === 'pending'
    getKeepAwakeController().setSource(`statusbar:${projectId}`, producing)
    return () => getKeepAwakeController().setSource(`statusbar:${projectId}`, false)
  }, [status, projectId])

  // DownloadProgressPolling
  useEffect(() => {
    if (status === 'downloading') {
      let cancelled = false
      const pollDownloadProgress = async () => {
        try {
          console.log(`PollingDownloadProgress: ${projectId}`)
          const response = await fetch(apiConfigManager.buildUrl(`/projects/${projectId}`))
          if (cancelled || !response.ok) {
            if (!cancelled && !response.ok) {
              console.error('ObtainProjectDataFailed:', response.status, response.statusText)
            }
            return
          }
          const projectData = await response.json()
          if (cancelled) return
          console.log('ProjectData:', projectData)
          const newProgress = readDownloadProgress(projectData)
          console.log(`DownloadProgressUpdate: ${newProgress}%`)
          setPolledProgress(newProgress)
          onDownloadProgressUpdate?.(newProgress)

          if (newProgress >= 100) {
            console.log('DownloadDone，Switch to processingStatus')
            setTimeout(() => {
              onStatusChange?.('processing')
            }, 1000)
          }
        } catch (error) {
          if (!cancelled) console.error('ObtainDownloadProgressFailed:', error)
        }
      }

      // Get once now
      pollDownloadProgress()
      
      // Every5secondsPoll once，Reduce frequent requests
      const interval = setInterval(pollDownloadProgress, 5000)
      
      return () => {
        cancelled = true
        clearInterval(interval)
      }
    }
  }, [status, projectId, onDownloadProgressUpdate, onStatusChange])

  // ProcessStatusChange
  useEffect(() => {
    if (progress) {
      // ProgressWhen the final state is reached，Stop polling immediatelyandSynchronizeStatus
      if (isCompleted(progress.stage) || isFailed(progress.message)) {
        if (isPolling) {
          console.log(`ProgressReached final state，Stop Polling: ${projectId}`)
          stopPolling()
          setIsPolling(false)
        }
        if (onStatusChange) {
          onStatusChange(isCompleted(progress.stage) ? 'completed' : 'failed')
        }
      }
    }
  }, [progress, onStatusChange])

  // ===== Calm Premium StatusDisplay（See DESIGN.md）=====
  // In progress：DetailedProgressLine + Tags + Right side mono HundredpointsCompare
  const ProgressRow = ({ label, percent }: { label: string; percent: number }) => (
    <div style={{ width: '100%' }}>
      <div style={{ height: 4, background: 'var(--ac-line)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(0, Math.min(100, percent))}%`, background: 'var(--ac-accent)', borderRadius: 999, transition: 'width .4s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 9 }}>
        <span style={{ color: 'var(--ac-sub)', fontSize: 12.5 }}>{label}</span>
        <span className="ac-mono" style={{ color: 'var(--ac-accent)', fontSize: 12.5 }}>{Math.round(percent)}%</span>
      </div>
    </div>
  )
  // Final state：Small dot + Tags
  const StatusRow = ({ label, dot, color }: { label: string; dot: string; color: string }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, height: 4 + 9 + 12.5 + 2, minHeight: 26 }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: dot, flex: '0 0 auto' }} />
      <span style={{ color, fontSize: 12.5 }}>{label}</span>
    </div>
  )

  if (status === 'importing') return <ProgressRow label={t("Importing")} percent={downloadProgress} />
  if (status === 'downloading') return <ProgressRow label={t("Downloading")} percent={shownDownloadProgress} />

  if (status === 'processing') {
    if (!progress) return <ProgressRow label={t("Initializing")} percent={0} />
    const { stage, percent, message } = progress
    if (isFailed(message)) return <StatusRow label={t("Processing failed")} dot="var(--ac-error)" color="var(--ac-error)" />
    return <ProgressRow label={getStageDisplayName(stage)} percent={percent} />
  }

  if (status === 'completed') return <StatusRow label={t("Completed")} dot="var(--ac-ok)" color="var(--ac-sub)" />
  if (status === 'failed') return <StatusRow label={t("Processing failed")} dot="var(--ac-error)" color="var(--ac-error)" />

  // Waiting
  return <StatusRow label={t("Waiting")} dot="var(--ac-muted)" color="var(--ac-muted)" />
}

// SimplifiedProgressclipsComponent - Used for detailsProgressShow
interface SimpleProgressDisplayProps {
  projectId: string
  status: string
  showDetails?: boolean
}

export const SimpleProgressDisplay: React.FC<SimpleProgressDisplayProps> = ({
  projectId,
  status,
  showDetails = false
}) => {
  useTranslation()
  const { getProgress } = useSimpleProgressStore()
  const progress = getProgress(projectId)

  if (status !== 'processing' || !progress || !showDetails) {
    return null
  }

  const { stage, percent, message } = progress
  const stageColor = getStageColor(stage)

  return (
    <div style={{ marginTop: '8px' }}>
      <Progress
        percent={percent}
        strokeColor={stageColor}
        showInfo={true}
        size="small"
        format={(percent) => `${percent}%`}
      />
      {message && (
        <Text type="secondary" style={{ fontSize: '11px', display: 'block', marginTop: '4px' }}>
          {message}
        </Text>
      )}
    </div>
  )
}
