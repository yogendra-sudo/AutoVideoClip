import { t } from '../i18n'
/**
 * SimplifiedProgressStatusManage - Based on fixed levelclipsand polling
 */

import { create } from 'zustand'

export interface SimpleProgress {
  project_id: string
  stage: string
  percent: number
  message: string
  ts: number
}

interface SimpleProgressState {
  // StatusData
  byId: Record<string, SimpleProgress>
  
  // Polling control
  pollingInterval: number | null
  isPolling: boolean
  
  // ActionsMethod
  upsert: (progress: SimpleProgress) => void
  startPolling: (projectIds: string[], intervalMs?: number) => void
  stopPolling: () => void
  clearProgress: (projectId: string) => void
  clearAllProgress: () => void
  
  // Get Method
  getProgress: (projectId: string) => SimpleProgress | null
  getAllProgress: () => Record<string, SimpleProgress>
}

export const useSimpleProgressStore = create<SimpleProgressState>((set, get) => {
  let timer: number | null = null

  return {
    // InitialStatus
    byId: {},
    pollingInterval: null,
    isPolling: false,

    // Update or insertProgressData
    upsert: (progress: SimpleProgress) => {
      set((state) => ({
        byId: {
          ...state.byId,
          [progress.project_id]: progress
        }
      }))
    },

    // Start polling
    startPolling: (projectIds: string[], intervalMs: number = 5000) => {
      const { stopPolling, isPolling } = get()
      
      // If it is alreadyGet it from thePolling，Stop first
      if (isPolling) {
        stopPolling()
      }

      if (projectIds.length === 0) {
        console.warn('NoneProjectID，Skip polling')
        return
      }

      console.log(`Start pollingProgress: ${projectIds.join(', ')}`)

      // Get once now
      const fetchSnapshots = async () => {
        try {
          const queryString = projectIds.map(id => `project_ids=${id}`).join('&')
          const response = await fetch(`/api/v1/simple-progress/snapshot?${queryString}`)
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
          }
          
          const snapshots: SimpleProgress[] = await response.json()
          
          // UpdateStatus
          snapshots.forEach(snapshot => {
            console.log(`UpdateProgress: ${snapshot.project_id} - ${snapshot.stage} (${snapshot.percent}%)`)
            get().upsert(snapshot)
          })
          
          console.log(`Polling update: ${snapshots.length} ItemProject`)
          
          // If there is nothingProgress，or allProjectAll have reached the final state.，ThenAutoStop Polling
          try {
            const allTerminal = snapshots.length > 0 && snapshots.every(s => {
              return isCompleted(s.stage) || isFailed(s.message)
            })
            // Only when there isProgressAnd allProjectAllCompletedPolling will only stop when
            // Ifsnapshots.length === 0，ExplanationProjectPossibly alsoGet it from thependingStatus，Polling should not be stopped
            if (snapshots.length > 0 && allTerminal) {
              console.log('AllProjectCompleted，AutoStop Polling')
              get().stopPolling()
            } else if (snapshots.length === 0) {
              console.log('Project status is pending; continue polling.')
            }
          } catch (e) {
            // Protective capture: avoid affecting the continued polling logic.
            console.warn('Could not inspect the final state, but polling will continue:', e)
          }
          
        } catch (error) {
          console.error('PollingProgressFailed:', error)
        }
      }

      // Execute once immediately
      fetchSnapshots()

      // SettingsLaterDevice
      timer = window.setInterval(fetchSnapshots, intervalMs)

      set({
        isPolling: true,
        pollingInterval: intervalMs
      })
    },

    // Stop Polling
    stopPolling: () => {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      
      set({
        isPolling: false,
        pollingInterval: null
      })
      
      console.log('Stop PollingProgress')
    },

    // Clear singleProjectProgress
    clearProgress: (projectId: string) => {
      set((state) => {
        const newById = { ...state.byId }
        delete newById[projectId]
        return { byId: newById }
      })
    },

    // Clear AllProgress
    clearAllProgress: () => {
      set({ byId: {} })
    },

    // Get singleProjectProgress
    getProgress: (projectId: string) => {
      return get().byId[projectId] || null
    },

    // Get allProgress
    getAllProgress: () => {
      return get().byId
    }
  }
})

// StageclipsDisplay nameMapping
export const STAGE_DISPLAY_NAMES: Record<string, string> = {
  get 'INGEST'() { return t("Preparing media") },
  get 'SUBTITLE'() { return t("Processing subtitles") },
  get 'ANALYZE'() { return t("Analyzing content") },
  get 'HIGHLIGHT'() { return t("Locating segments") },
  get 'EXPORT'() { return t("Exporting video") },
  get 'DONE'() { return t("Processing complete") }
}

// StageclipsColor mapping
export const STAGE_COLORS: Record<string, string> = {
  'INGEST': '#1890ff',      // Blue
  'SUBTITLE': '#52c41a',    // Green
  'ANALYZE': '#fa8c16',     // Orange
  'HIGHLIGHT': '#722ed1',   // Purple
  'EXPORT': '#eb2f96',      // Pink
  'DONE': '#13c2c2'         // Cyan
}

// Obtain levelclipsDisplay name
export const getStageDisplayName = (stage: string): string => {
  return STAGE_DISPLAY_NAMES[stage] || stage
}

// Obtain levelclipsColor
export const getStageColor = (stage: string): string => {
  return STAGE_COLORS[stage] || '#666666'
}

// Determine whether it isDoneStatus
export const isCompleted = (stage: string): boolean => {
  return stage === 'DONE'
}

// Determine whether it isFailedStatus
export const isFailed = (message: string): boolean => {
  return message.includes('Failed') || message.includes('Error') || message.includes('Failed')
}
