import { useEffect, useRef, useState } from 'react'
import { projectApi } from '../services/api'
import { Project, useProjectStore } from '../store/useProjectStore'

/** Wire a backend-ready signal to an immediate project-list refresh (#487/#502). */
export function bindRestartRefresh(
  subscribeRestart: (onRestart: () => void) => () => void,
  refresh: () => void | Promise<void>,
): () => void {
  return subscribeRestart(() => {
    void Promise.resolve(refresh()).catch(() => undefined)
  })
}

interface UseProjectPollingOptions {
  interval?: number // Polling interval，Default10seconds
  onProjectsUpdate?: (projects: Project[]) => void
  enabled?: boolean // Yes/NoEnablePolling
  /** Same shape as studio observeWorkspace: fire when the shell has a ready backend again. */
  subscribeRestart?: (onRestart: () => void) => () => void
}

export const useProjectPolling = ({
  interval = 30000, // Default30seconds，Reduce frequent requests
  onProjectsUpdate,
  enabled = true,
  subscribeRestart,
}: UseProjectPollingOptions = {}) => {
  const [isPolling, setIsPolling] = useState(false)
  const intervalRef = useRef<number | null>(null)
  const [lastUpdateTime, setLastUpdateTime] = useState<number>(Date.now())

    const startPolling = () => {
    if (!enabled || intervalRef.current) return

    setIsPolling(true)
    
    const poll = async () => {
      try {
        // Get in real timeisDraggingStatus
        const currentIsDragging = useProjectStore.getState().isDragging
        
        // Skip polling while a drag-and-drop operation is in progress.
        if (currentIsDragging) {
          console.log('Skipping poll: dragging in progress')
          return
        }
        
        console.log('Polling projects...')
        const projects = await projectApi.getProjects()
        console.log('Polled projects:', projects)
        
        // EnsureprojectsIs an array type
        const safeProjects = Array.isArray(projects) ? projects : []
        const hasProcessingProjects = safeProjects.some(p => p.status === 'processing')
        
        if (onProjectsUpdate) {
          console.log('Calling onProjectsUpdate with:', safeProjects)
          onProjectsUpdate(safeProjects)
        }
        
        setLastUpdateTime(Date.now())
        
        // Back off polling when no project is actively processing.
        if (!hasProcessingProjects) {
          // If not activeProject，The polling frequency can be further reduced.
          console.log('No activeProject，Polling frequency will be reduced')
        }
      } catch (error) {
        console.error('Polling error:', error)
      }
    }

    // Execute once immediately
    poll()
    
    // SettingsLaterDevice
    intervalRef.current = window.setInterval(poll, interval)
  }

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setIsPolling(false)
  }

  const refreshNow = async () => {
    try {
      const projects = await projectApi.getProjects()
      // EnsureprojectsIs an array type
      const safeProjects = Array.isArray(projects) ? projects : []
      if (onProjectsUpdate) {
        onProjectsUpdate(safeProjects)
      }
      setLastUpdateTime(Date.now())
      return safeProjects
    } catch (error) {
      console.error('Manual refresh error:', error)
      throw error
    }
  }

  useEffect(() => {
    if (enabled) {
      startPolling()
    } else {
      stopPolling()
    }

    return () => {
      stopPolling()
    }
  }, [enabled, interval])

  // #487/#502: after autovideoclip-backend respawns, do not wait for the 30s poll —
  // refresh so home cards pick up service_restarted / catalog copy immediately.
  useEffect(() => {
    if (!enabled || !subscribeRestart) return
    // refreshNow returns Promise<Project[]>; bindRestartRefresh only needs void/Promise<void>.
    return bindRestartRefresh(subscribeRestart, () => { void refreshNow() })
  }, [enabled, subscribeRestart])

  return {
    isPolling,
    lastUpdateTime,
    startPolling,
    stopPolling,
    refreshNow
  }
}

export default useProjectPolling