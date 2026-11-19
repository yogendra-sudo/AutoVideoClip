import { t } from '../i18n'
import { useTranslation } from 'react-i18next'
import React from 'react'

/**
 * External Link Processing Tool
 * Get it from theTauriSafely in the environmentOnExternal link
 */

// Detect whetherGet it from theTauriIn the environment
const isTauri = () => {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI__ || (window as any).__TAURI_INTERNALS__)
}

/**
 * OnExternal link
 * @param url ToOnofURL
 */
export const openExternalLink = async (url: string) => {
  try {
    if (isTauri()) {
      // Get it from theTauriUsed in the environmentshell API
      const { open } = await import('@tauri-apps/plugin-shell')
      await open(url)
    } else {
      // Get it from theWebUse the normal method in the environment
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  } catch (error) {
    console.error('OnExternal linkFailed:', error)
    // Downgrade handling:Try usingwindow.open
    try {
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (fallbackError) {
      console.error('DowngradeOpen linkAlsoFailed:', fallbackError)
      // Final downgrade:Copy link to clipboard
      try {
        await navigator.clipboard.writeText(url)
        alert(t("Link copied: {{value1}}", { value1: url }))
      } catch (clipboardError) {
        console.error('Copy to clipboardFailed:', clipboardError)
        alert(t("Open this link manually: {{value1}}", { value1: url }))
      }
    }
  }
}

/**
 * Create a clickable external link component
 * @param url Link address
 * @param text ShowText
 * @param className CSSClass name
 */
export const ExternalLink: React.FC<{
  url: string
  text: string
  className?: string
}> = ({ url, text, className }) => {
  useTranslation()
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    openExternalLink(url)
  }

  return (
    <a
      href={url}
      onClick={handleClick}
      className={className}
      style={{ 
        color: '#1890ff',
        cursor: 'pointer',
        textDecoration: 'underline'
      }}
    >
      {text}
    </a>
  )
}
