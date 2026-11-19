type TFn = (key: string) => string

/** zh source string doubles as the i18n key (8 locales). */
const WHISPER_DOWNLOAD_FAILED = 'Whisper model download failed. Check your network and download again in Settings → Default models → Speech to subtitles, or switch the download source to the hf-mirror mirror.'

/** pick translated copy by the stable backend errorCode; legacy rows keep errorMessage.*/
export function whisperModelErrorText(t: TFn, model: { errorCode?: string | null; errorMessage?: string | null }): string {
  if (model.errorCode === 'whisper_download_failed') return t(WHISPER_DOWNLOAD_FAILED)
  return model.errorMessage || ''
}
