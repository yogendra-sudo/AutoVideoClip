type Translate = (key: string, values?: Record<string, unknown>) => string

/** ComponentInstall（Whisper / Person Recognition）FailedReason：Stable from the backend error_code，Interface byLanguageShow。None code Use the original backend text。 */
export function pipInstallErrorText(t: Translate, status?: { error_code?: string; message?: string } | null): string {
  switch (status?.error_code) {
    case 'pip_network':
      return t('Install failed: could not reach the pip index. Check your network or proxy and try again, or set the PIP_INDEX_URL environment variable to an index that works.')
    case 'pip_timeout':
      return t('Install failed: the download timed out. Check your network and try again.')
    case 'pip_source_build':
      return t('Install failed: no prebuilt package was available, so building from source was stopped. Check your network and try again.')
    case 'pip_cancelled':
      return t('Install cancelled')
    default:
      return status?.message || ''
  }
}
