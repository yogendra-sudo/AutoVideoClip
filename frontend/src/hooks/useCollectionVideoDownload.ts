import { t } from '../i18n'
import { useState } from 'react'
import { message } from 'antd'
import { projectApi } from '../services/api'

export const useCollectionVideoDownload = () => {
  const [isGenerating, setIsGenerating] = useState(false)

  const generateAndDownloadCollectionVideo = async (
    projectId: string, 
    collectionId: string,
    _collectionTitle: string
  ) => {
    if (isGenerating) return

    setIsGenerating(true)
    
    try {
      // Generate directly in the order currently adjusted by the userCollectionsVideo
      message.info(t("Generating the collection video in your chosen order…"))
      
      // GenerateCollectionsVideo（In the order adjusted by the user）
      await projectApi.generateCollectionVideo(projectId, collectionId)
      
      // Waiting1secondsLet the backendDoneFile generation，ThenDownload
      message.success(t("Collection video ready. Downloading…"))
      
      setTimeout(async () => {
        try {
          await projectApi.downloadVideo(projectId, undefined, collectionId)
          message.success(t("Collection video downloaded"))
        } catch (downloadError) {
          console.error('Download failed:', downloadError)
          message.error(t("Download failed. Try again later."))
        }
      }, 1000)
      
    } catch (error) {
      console.error('Could not generate collection video:', error)
      message.error(t("Could not generate collection video"))
    } finally {
      setIsGenerating(false)
    }
  }

  return {
    isGenerating,
    generateAndDownloadCollectionVideo
  }
} 